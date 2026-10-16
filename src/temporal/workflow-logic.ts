// Pure, deterministic state transitions used by the workflow. Kept separate
// from workflows.ts so they can be unit-tested directly without spinning up
// a Temporal test environment.

export interface ResponseState {
  acceptedDonorIds: Set<string>;
  declinedDonorIds: Set<string>;
}

export function newResponseState(): ResponseState {
  return { acceptedDonorIds: new Set(), declinedDonorIds: new Set() };
}

// Applies a donor's signal response. A response from a donor who was never
// contacted for this request is invalid and ignored. A donor who already
// responded (accept or decline) cannot flip their answer by signaling again.
export function applyDonorResponse(
  state: ResponseState,
  contactedDonorIds: ReadonlySet<string>,
  donorId: string,
  accepted: boolean,
): ResponseState {
  if (!contactedDonorIds.has(donorId)) return state;
  if (state.acceptedDonorIds.has(donorId) || state.declinedDonorIds.has(donorId)) return state;

  const next: ResponseState = {
    acceptedDonorIds: new Set(state.acceptedDonorIds),
    declinedDonorIds: new Set(state.declinedDonorIds),
  };
  if (accepted) next.acceptedDonorIds.add(donorId);
  else next.declinedDonorIds.add(donorId);
  return next;
}

export function hasReachedTarget(state: ResponseState, targetDonorAcceptances: number): boolean {
  return state.acceptedDonorIds.size >= targetDonorAcceptances;
}
