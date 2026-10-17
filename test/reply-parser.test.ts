import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAcceptVeto } from "../src/intake/reply-parser.ts";

const accept = { decision: "accept" as const, etaMinutes: 30, note: "" };

test("a clean accept stays an accept", () => {
  assert.equal(applyAcceptVeto("Yes coming in 30 minutes", accept).decision, "accept");
});

test("a negation turns a model accept into unclear", () => {
  assert.equal(applyAcceptVeto("sorry can't today, maybe tomorrow", accept).decision, "unclear");
  assert.equal(applyAcceptVeto("aaj nahi ho payega", accept).decision, "unclear");
});

test("declines are never upgraded", () => {
  const decline = { decision: "decline" as const, etaMinutes: null, note: "" };
  assert.equal(applyAcceptVeto("yes", decline).decision, "decline");
});

test("a conditional reply is never counted as coming", () => {
  assert.equal(applyAcceptVeto("Can I come after 6pm instead? stuck at office", accept).decision, "unclear");
  assert.equal(applyAcceptVeto("will try, kal subah", accept).decision, "unclear");
  assert.equal(applyAcceptVeto("haan aa raha hoon, 20 min mein pahunch jaunga", accept).decision, "accept");
});
