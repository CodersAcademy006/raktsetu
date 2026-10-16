import { test } from "node:test";
import assert from "node:assert/strict";
import { newResponseState, applyDonorResponse, hasReachedTarget } from "../src/temporal/workflow-logic.ts";

test("accepted response from a contacted donor is recorded", () => {
  const state = applyDonorResponse(newResponseState(), new Set(["d1"]), "d1", true);
  assert.equal(state.acceptedDonorIds.has("d1"), true);
});

test("response from a donor who was never contacted is ignored", () => {
  const state = applyDonorResponse(newResponseState(), new Set(["d1"]), "d2", true);
  assert.equal(state.acceptedDonorIds.size, 0);
  assert.equal(state.declinedDonorIds.size, 0);
});

test("a donor cannot flip their answer by responding twice", () => {
  const contacted = new Set(["d1"]);
  let state = applyDonorResponse(newResponseState(), contacted, "d1", true);
  state = applyDonorResponse(state, contacted, "d1", false);
  assert.equal(state.acceptedDonorIds.has("d1"), true);
  assert.equal(state.declinedDonorIds.has("d1"), false);
});

test("duplicate accept signals from the same donor count once", () => {
  const contacted = new Set(["d1"]);
  let state = newResponseState();
  state = applyDonorResponse(state, contacted, "d1", true);
  state = applyDonorResponse(state, contacted, "d1", true);
  assert.equal(state.acceptedDonorIds.size, 1);
});

test("target is reached only once enough distinct donors accept", () => {
  const contacted = new Set(["d1", "d2"]);
  let state = applyDonorResponse(newResponseState(), contacted, "d1", true);
  assert.equal(hasReachedTarget(state, 2), false);
  state = applyDonorResponse(state, contacted, "d2", true);
  assert.equal(hasReachedTarget(state, 2), true);
});
