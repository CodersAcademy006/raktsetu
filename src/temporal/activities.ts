import { randomUUID } from "node:crypto";
import { getDb, type BankReservation, type BloodBankDoc, type DispatchDoc, type DonorDoc, type RequestDoc, type WorkflowEventDoc } from "../db/mongo.ts";
import { compatibleDonorGroups } from "../matching/compatibility.ts";
import { isEligible, eligibilityQuery } from "../matching/eligibility.ts";
import { DemoWebProvider } from "../dispatch/demo-web-provider.ts";
import { outreachFacts } from "../dispatch/message.ts";
import { draftOpener } from "../dispatch/outreach.ts";

const BATCH_SIZE = 10;
const provider = new DemoWebProvider();

export async function logEvent(requestId: string, type: string, metadata: Record<string, unknown> = {}): Promise<void> {
  const db = await getDb();
  const doc: WorkflowEventDoc = { eventId: randomUUID(), requestId, type, timestamp: new Date(), metadata };
  await db.collection<WorkflowEventDoc>("workflow_events").insertOne(doc);
}

export async function getRequest(requestId: string): Promise<RequestDoc> {
  const db = await getDb();
  const req = await db.collection<RequestDoc>("requests").findOne({ requestId });
  if (!req) throw new Error(`request ${requestId} not found`);
  return req;
}

// Units from a bank farther than this take longer to arrive than a nearby
// donor walking in, so they are not reserved. Tune per city.
const BANK_RADIUS_KM = 10;

// Banks first: before any donor is contacted, reserve compatible units from
// the nearest banks within BANK_RADIUS_KM. Each unit comes off the
// shelf through a conditional decrement, so two requests can never reserve
// the same unit. Exact-group units are taken before other compatible groups.
// Returns how many donors are still needed after the reservations.
export async function reserveBankUnits(requestId: string): Promise<number> {
  const db = await getDb();
  const request = await getRequest(requestId);
  const component = request.component ?? "whole_blood";
  const groups = compatibleDonorGroups(request.requiredBloodGroup, component);
  const ordered = [request.requiredBloodGroup, ...groups.filter((g) => g !== request.requiredBloodGroup)].filter((g) =>
    groups.includes(g),
  );
  const banksColl = db.collection<BloodBankDoc>("blood_banks");

  const banks = await banksColl
    .aggregate<BloodBankDoc & { distanceMeters: number }>([
      {
        $geoNear: {
          near: request.location,
          distanceField: "distanceMeters",
          maxDistance: BANK_RADIUS_KM * 1000,
          spherical: true,
        },
      },
    ])
    .toArray();

  let remaining = request.unitsRequested;
  const reservations: BankReservation[] = [];
  for (const bank of banks) {
    for (const group of ordered) {
      if (remaining === 0) break;
      const field = `stock.${component}.${group}`;
      const available = bank.stock?.[component]?.[group] ?? 0;
      const take = Math.min(available, remaining);
      if (take === 0) continue;
      const res = await banksColl.updateOne({ bankId: bank.bankId, [field]: { $gte: take } }, { $inc: { [field]: -take } });
      if (res.modifiedCount === 0) continue; // someone else took it first
      remaining -= take;
      reservations.push({
        bankId: bank.bankId,
        name: bank.name,
        phone: bank.phone,
        distanceKm: Math.round(bank.distanceMeters / 100) / 10,
        bloodGroup: group,
        units: take,
      });
    }
  }

  const reserved = request.unitsRequested - remaining;
  const donorsNeeded = Math.max(0, request.targetDonorAcceptances - reserved);
  await db.collection<RequestDoc>("requests").updateOne({ requestId }, { $set: { bankReservations: reservations, donorsNeeded } });
  await logEvent(requestId, "BANKS_CHECKED", { reservedUnits: reserved, banks: reservations.length, donorsNeeded });
  return donorsNeeded;
}

// Eligible, compatible, opted-in donors within radiusKm who have not been
// contacted for this request yet, nearest first. Eligibility is part of the
// $geoNear filter, so the batch limit applies after it. isEligible() runs
// again as a cheap guard that the filter and the rule agree. Never decided by
// Gemma: donation eligibility is a medical rule, not a model judgment.
export async function findCandidates(requestId: string, radiusKm: number, limit = BATCH_SIZE): Promise<string[]> {
  const db = await getDb();
  const request = await getRequest(requestId);
  const now = new Date();

  const candidates = await db
    .collection<DonorDoc>("donors")
    .aggregate<DonorDoc>([
      {
        $geoNear: {
          near: request.location,
          distanceField: "distanceMeters",
          maxDistance: radiusKm * 1000,
          spherical: true,
          query: {
            bloodGroup: { $in: compatibleDonorGroups(request.requiredBloodGroup, request.component ?? "whole_blood") },
            optInStatus: true,
            active: true,
            donorId: { $nin: request.contactedDonorIds },
            ...eligibilityQuery(now),
          },
        },
      },
      { $limit: limit },
    ])
    .toArray();

  return candidates.filter((d) => isEligible(d, now)).map((d) => d.donorId);
}

export async function dispatchBatch(requestId: string, donorIds: string[], batchNo: number, responseWindowMs: number): Promise<void> {
  const db = await getDb();
  const request = await getRequest(requestId);
  const donors = await db.collection<DonorDoc>("donors").find({ donorId: { $in: donorIds } }).toArray();

  const facts = outreachFacts(request);
  const opener = await draftOpener(request);
  const baseUrl = (process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
  for (const donor of donors) {
    const dispatchId = randomUUID();
    // Link carries the dispatch id in the fragment, so it never reaches server logs or referrers.
    const text = `Hi ${donor.name},\n${opener.text}\n${facts}\nReply: ${baseUrl}/donor.html#${dispatchId}`;
    await provider.send({ dispatchId, donor, request, batchNo, text });
  }

  await db.collection<RequestDoc>("requests").updateOne(
    { requestId },
    {
      $set: { status: "WAITING", nextEscalationAt: new Date(Date.now() + responseWindowMs) },
      $addToSet: { contactedDonorIds: { $each: donorIds } },
    },
  );

  await logEvent(requestId, "BATCH_DISPATCHED_SIMULATED", {
    batchNo,
    donorIds,
    messageSource: opener.source,
  });
}

export async function setRequestRadius(requestId: string, radiusKm: number): Promise<void> {
  const db = await getDb();
  await db.collection<RequestDoc>("requests").updateOne({ requestId }, { $set: { currentRadiusKm: radiusKm, status: "MATCHING" } });
  await logEvent(requestId, "RADIUS_EXPANDED", { radiusKm });
}

export async function finalizeRequest(requestId: string, status: "FULFILLED" | "EXHAUSTED"): Promise<void> {
  const db = await getDb();
  await db.collection<RequestDoc>("requests").updateOne({ requestId }, { $set: { status, nextEscalationAt: null } });
  // Stand down everyone still pending: the donor page then shows "no longer needed".
  const stoodDown = await db
    .collection<DispatchDoc>("dispatches")
    .updateMany({ requestId, status: "sent" }, { $set: { status: "expired" } });
  if (stoodDown.modifiedCount > 0) await logEvent(requestId, "DONORS_STOOD_DOWN", { count: stoodDown.modifiedCount });
  await logEvent(requestId, status === "FULFILLED" ? "REQUEST_COMPLETED" : "REQUEST_EXHAUSTED", {});
}
