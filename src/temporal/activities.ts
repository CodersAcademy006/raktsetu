import { randomUUID } from "node:crypto";
import { getDb, type DispatchDoc, type DonorDoc, type RequestDoc, type WorkflowEventDoc } from "../db/mongo.ts";
import { compatibleDonorGroups } from "../matching/compatibility.ts";
import { isEligible, eligibilityQuery } from "../matching/eligibility.ts";
import { DemoWebProvider } from "../dispatch/demo-web-provider.ts";

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

  for (const donor of donors) {
    const text = `Emergency: ${request.requiredBloodGroup} blood needed near ${request.locationText}, ${request.unitsRequested} unit(s), ${request.urgency}. Reply if you can donate today.`;
    await provider.send({ donor, request, batchNo, text });
  }

  await db.collection<RequestDoc>("requests").updateOne(
    { requestId },
    {
      $set: { status: "WAITING", nextEscalationAt: new Date(Date.now() + responseWindowMs) },
      $push: { contactedDonorIds: { $each: donorIds } },
    },
  );

  await logEvent(requestId, "BATCH_DISPATCHED_SIMULATED", {
    batchNo,
    donorIds,
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
