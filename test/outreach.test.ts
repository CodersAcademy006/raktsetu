import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeOpener } from "../src/dispatch/outreach.ts";

test("a plain, short opener is accepted", () => {
  assert.equal(isSafeOpener("A patient close to you urgently needs your help today. Please come if you can."), true);
});

test("drafts that could carry invented details are rejected", () => {
  assert.equal(isSafeOpener("Please come to ward 3 now, a patient needs you."), false); // digit
  assert.equal(isSafeOpener("Please help, details at https://example.com for the patient"), false);
  assert.equal(isSafeOpener("Help!"), false); // too short
  assert.equal(isSafeOpener(null), false);
});
