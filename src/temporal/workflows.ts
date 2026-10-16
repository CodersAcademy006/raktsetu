import { proxyActivities, defineSignal, setHandler, condition } from "@temporalio/workflow";
import type * as activities from "./activities.ts";
import { ESCALATION_RADII_KM } from "../matching/eligibility.ts";
import { newResponseState, applyDonorResponse, hasReachedTarget } from "./workflow-logic.ts";

const { findCandidates, dispatchBatch, setRequestRadius, getRequest, finalizeRequest } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 5 },
});

// Short for the demo so a full escalation run finishes in well under a minute;
// a real deployment would set this to several minutes per the hospital's SLA.
// Read from process.env by the caller (workflow code has no Node globals).
const DEFAULT_RESPONSE_WINDOW_MS = 15_000;

export const donorResponseSignal = defineSignal<[{ donorId: string; accepted: boolean }]>("donorResponse");

export async function EmergencyRequestWorkflow(requestId: string, responseWindowMs = DEFAULT_RESPONSE_WINDOW_MS): Promise<void> {
  const request = await getRequest(requestId);
  let state = newResponseState();
  const contactedDonorIds = new Set<string>();

  setHandler(donorResponseSignal, ({ donorId, accepted }) => {
    state = applyDonorResponse(state, contactedDonorIds, donorId, accepted);
  });

  let currentRadius: number | null = null;
  let batchNo = 0;

  for (const radiusKm of ESCALATION_RADII_KM) {
    currentRadius = radiusKm;
    await setRequestRadius(requestId, currentRadius);

    const candidates = await findCandidates(requestId, currentRadius);
    if (candidates.length === 0) continue;

    batchNo += 1;
    for (const donor of candidates) contactedDonorIds.add(donor.donorId);
    await dispatchBatch(requestId, candidates, batchNo);

    const reachedTarget = await condition(
      () => hasReachedTarget(state, request.targetDonorAcceptances),
      responseWindowMs,
    );
    if (reachedTarget) {
      await finalizeRequest(requestId, "FULFILLED");
      return;
    }
  }

  await finalizeRequest(requestId, "EXHAUSTED");
}
