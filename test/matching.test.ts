import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompatibleDonor, compatibleDonorGroups, BLOOD_GROUPS } from "../src/matching/compatibility.ts";
import { isEligibleToday, nextRadiusKm, DONATION_COOLDOWN_DAYS, ESCALATION_RADII_KM } from "../src/matching/eligibility.ts";

test("O- is a universal donor", () => {
  for (const recipient of BLOOD_GROUPS) {
    assert.equal(isCompatibleDonor("O-", recipient), true, `O- should donate to ${recipient}`);
  }
});

test("AB+ is a universal recipient", () => {
  assert.deepEqual(compatibleDonorGroups("AB+").sort(), [...BLOOD_GROUPS].sort());
});

test("AB- can only receive from Rh-negative donors", () => {
  assert.deepEqual(compatibleDonorGroups("AB-").sort(), ["O-", "A-", "B-", "AB-"].sort());
});

test("O+ cannot donate to O-", () => {
  assert.equal(isCompatibleDonor("O+", "O-"), false);
});

test("donor with no prior donation is eligible", () => {
  assert.equal(isEligibleToday(null), true);
});

test(`donor is ineligible before ${DONATION_COOLDOWN_DAYS}-day cooldown elapses`, () => {
  const now = new Date("2026-10-16T00:00:00Z");
  const donatedYesterday = new Date("2026-10-15T00:00:00Z");
  assert.equal(isEligibleToday(donatedYesterday, now), false);
});

test("donor becomes eligible exactly at the cooldown boundary", () => {
  const now = new Date("2026-10-16T00:00:00Z");
  const exactlyNinetyDaysAgo = new Date(now.getTime() - DONATION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
  assert.equal(isEligibleToday(exactlyNinetyDaysAgo, now), true);
});

test("radius escalates through the fixed ladder", () => {
  assert.equal(nextRadiusKm(null), ESCALATION_RADII_KM[0]);
  assert.equal(nextRadiusKm(5), 10);
  assert.equal(nextRadiusKm(10), 25);
  assert.equal(nextRadiusKm(25), 50);
});

test("radius escalation stops after the widest ring", () => {
  assert.equal(nextRadiusKm(50), null);
});
