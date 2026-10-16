import { randomUUID } from "node:crypto";
import { getDb, type DispatchDoc, type DonorDoc, type RequestDoc, type WorkflowEventDoc } from "../db/mongo.ts";
import { compatibleDonorGroups } from "../matching/compatibility.ts";
import { isEligibleToday } from "../matching/eligibility.ts";
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

// Queries eligible, compatible, opted-in donors within radiusKm who have not
// already been contacted for this request, nearest first. The Mongo $near
// query does the geospatial work; this layer applies the compatibility and
// eligibility rules on top (never Gemma — donation eligibility is a
// deterministic rule, not a language-model judgment call).
export async function findCandidates(
  requestId: string,
  radiusKm: number,
): Promise<DonorDoc[]> {
  const db = await getDb();
  const request = await getRequest(requestId);
  const compatibleGroups = compatibleDonorGroups(request.requiredBloodGroup);

  const candidates = await db
    .collection<DonorDoc>("donors")
    .find({
      bloodGroup: { $in: compatibleGroups },
      optInStatus: true,
      active: true,
      donorId: { $nin: request.contactedDonorIds },
      location: {
        $near: {
          $geometry: request.location,
          $maxDistance: radiusKm * 1000,
        },
      },
    })
    .limit(BATCH_SIZE)
    .toArray();

  return candidates.filter((d) => isEligibleToday(d.lastDonationDate));
}

export async function dispatchBatch(requestId: string, donors: DonorDoc[], batchNo: number): Promise<void> {
  const db = await getDb();
  const request = await getRequest(requestId);

  for (const donor of donors) {
    const text = `Emergency: ${request.requiredBloodGroup} blood needed near ${request.locationText}, ${request.unitsRequested} unit(s), ${request.urgency}. Reply if you can donate today.`;
    await provider.send({ donor, request, batchNo, text });
  }

  await db.collection<RequestDoc>("requests").updateOne(
    { requestId },
    {
      $set: { status: "WAITING", currentRadiusKm: request.currentRadiusKm },
      $push: { contactedDonorIds: { $each: donors.map((d) => d.donorId) } },
    },
  );

  await logEvent(requestId, "BATCH_DISPATCHED_SIMULATED", {
    batchNo,
    donorIds: donors.map((d) => d.donorId),
  });
}

export async function setRequestRadius(requestId: string, radiusKm: number): Promise<void> {
  const db = await getDb();
  await db.collection<RequestDoc>("requests").updateOne({ requestId }, { $set: { currentRadiusKm: radiusKm, status: "MATCHING" } });
  await logEvent(requestId, "RADIUS_EXPANDED", { radiusKm });
}

export async function finalizeRequest(requestId: string, status: "FULFILLED" | "EXHAUSTED"): Promise<void> {
  const db = await getDb();
  await db.collection<RequestDoc>("requests").updateOne({ requestId }, { $set: { status } });
  // Stand down everyone still pending: the donor page then shows "no longer needed".
  const stoodDown = await db
    .collection<DispatchDoc>("dispatches")
    .updateMany({ requestId, status: "sent" }, { $set: { status: "expired" } });
  if (stoodDown.modifiedCount > 0) await logEvent(requestId, "DONORS_STOOD_DOWN", { count: stoodDown.modifiedCount });
  await logEvent(requestId, status === "FULFILLED" ? "REQUEST_COMPLETED" : "REQUEST_EXHAUSTED", {});
}
