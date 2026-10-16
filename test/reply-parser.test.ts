import { test } from "node:test";
import assert from "node:assert/strict";
import { applyNegationVeto } from "../src/intake/reply-parser.ts";

const accept = { decision: "accept" as const, etaMinutes: 30, note: "" };

test("a clean accept stays an accept", () => {
  assert.equal(applyNegationVeto("Yes coming in 30 minutes", accept).decision, "accept");
});

test("a negation turns a model accept into unclear", () => {
  assert.equal(applyNegationVeto("sorry can't today, maybe tomorrow", accept).decision, "unclear");
  assert.equal(applyNegationVeto("aaj nahi ho payega", accept).decision, "unclear");
});

test("declines are never upgraded", () => {
  const decline = { decision: "decline" as const, etaMinutes: null, note: "" };
  assert.equal(applyNegationVeto("yes", decline).decision, "decline");
});
