import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionedBloodGroups, mentionedNumbers, mentionsLocality } from "../src/intake/verify.ts";

test("blood groups are recognised in the ways staff write them", () => {
  assert.deepEqual([...mentionedBloodGroups("O+ needed")], ["O+"]);
  assert.deepEqual([...mentionedBloodGroups("need AB negative urgently")], ["AB-"]);
  assert.deepEqual([...mentionedBloodGroups("b +ve 2 units")], ["B+"]);
  assert.deepEqual([...mentionedBloodGroups("A-ve pls")], ["A-"]);
});

test("text with no blood group yields none", () => {
  assert.equal(mentionedBloodGroups("blood needed urgently at Andheri, 2 units").size, 0);
});

test("unit counts are found as digits or words", () => {
  assert.ok(mentionedNumbers("2 units").has(2));
  assert.ok(mentionedNumbers("need two units").has(2));
  assert.equal(mentionedNumbers("someone help").size, 0);
});

test("a locality must be literally in the text", () => {
  assert.equal(mentionsLocality("O+ at Andheri East", "andheri"), true);
  assert.equal(mentionsLocality("O+ needed in Delhi", "andheri"), false);
});
