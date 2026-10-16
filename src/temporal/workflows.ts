import { proxyActivities, defineSignal, setHandler, condition } from "@temporalio/workflow";
import type * as activities from "./activities.ts";
import { ESCALATION_RADII_KM } from "../matching/eligibility.ts";
import { newResponseState, applyDonorResponse, hasReachedTarget, batchSettled } from "./workflow-logic.ts";

const { reserveBankUnits, findCandidates, dispatchBatch, setRequestRadius, finalizeRequest } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 5 },
});

// Short for the demo so a full escalation run takes a few minutes; a
// real deployment sets RAKTSETU_RESPONSE_WINDOW_MS (read by the API, since
// workflow code has no Node globals) to the hospital's SLA, e.g. 10 minutes.
const DEFAULT_RESPONSE_WINDOW_MS = 60_000;

export const donorResponseSignal = defineSignal<[{ donorId: string; accepted: boolean }]>("donorResponse");

export async function EmergencyRequestWorkflow(requestId: string, responseWindowMs = DEFAULT_RESPONSE_WINDOW_MS): Promise<void> {
  let state = newResponseState();
  const contactedDonorIds = new Set<string>();

  setHandler(donorResponseSignal, ({ donorId, accepted }) => {
    state = applyDonorResponse(state, contactedDonorIds, donorId, accepted);
  });

  const target = await reserveBankUnits(requestId);
  if (target === 0) {
    await finalizeRequest(requestId, "FULFILLED");
    return;
  }

  let batchNo = 0;
  for (const radiusKm of ESCALATION_RADII_KM) {
    await setRequestRadius(requestId, radiusKm);

    // Keep sending batches at this radius until it runs out of uncontacted
    // eligible donors; only then widen the search.
    for (;;) {
      const batch = await findCandidates(requestId, radiusKm);
      if (batch.length === 0) break;

      batchNo += 1;
      for (const id of batch) contactedDonorIds.add(id);
      await dispatchBatch(requestId, batch, batchNo, responseWindowMs);

      // Wake early if the target is met or everyone in this batch has
      // answered (e.g. all declined) instead of sitting out the window.
      await condition(() => hasReachedTarget(state, target) || batchSettled(state, batch), responseWindowMs);
      if (hasReachedTarget(state, target)) {
        await finalizeRequest(requestId, "FULFILLED");
        return;
      }
    }
  }

  await finalizeRequest(requestId, "EXHAUSTED");
}
