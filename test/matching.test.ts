import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompatibleDonor, compatibleDonorGroups, BLOOD_GROUPS } from "../src/matching/compatibility.ts";
import { isEligible, COOLDOWN_DAYS, MIN_WEIGHT_KG, type EligibilityFields } from "../src/matching/eligibility.ts";

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

const NOW = new Date("2026-10-16T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const donor = (over: Partial<EligibilityFields> = {}): EligibilityFields => ({
  sex: "M",
  dateOfBirth: new Date("1995-01-01T00:00:00Z"),
  weightKg: 70,
  lastDonationDate: null,
  ...over,
});

test("first-time adult donor is eligible", () => {
  assert.equal(isEligible(donor(), NOW), true);
});

test("men wait 90 days, women 120 days between donations", () => {
  const ninetyDaysAgo = new Date(NOW.getTime() - 90 * DAY);
  assert.equal(isEligible(donor({ sex: "M", lastDonationDate: ninetyDaysAgo }), NOW), true);
  assert.equal(isEligible(donor({ sex: "F", lastDonationDate: ninetyDaysAgo }), NOW), false);
  assert.equal(isEligible(donor({ sex: "F", lastDonationDate: new Date(NOW.getTime() - 120 * DAY) }), NOW), true);
  assert.equal(isEligible(donor({ sex: "M", lastDonationDate: new Date(NOW.getTime() - 89 * DAY) }), NOW), false);
});

test("age must be 18 to 65 inclusive", () => {
  assert.equal(isEligible(donor({ dateOfBirth: new Date("2008-10-16T00:00:00Z") }), NOW), true); // 18 today
  assert.equal(isEligible(donor({ dateOfBirth: new Date("2008-10-17T00:00:00Z") }), NOW), false); // 18 tomorrow
  assert.equal(isEligible(donor({ dateOfBirth: new Date("1961-01-01T00:00:00Z") }), NOW), true); // 65
  assert.equal(isEligible(donor({ dateOfBirth: new Date("1960-10-16T00:00:00Z") }), NOW), false); // 66 today
});

test(`weight must be at least ${MIN_WEIGHT_KG} kg`, () => {
  assert.equal(isEligible(donor({ weightKg: 44 }), NOW), false);
  assert.equal(isEligible(donor({ weightKg: 45 }), NOW), true);
});

test("cooldowns match NBTC values", () => {
  assert.deepEqual(COOLDOWN_DAYS, { M: 90, F: 120 });
});

test("PRBC follows the red cell table", () => {
  assert.deepEqual(compatibleDonorGroups("O+", "prbc"), ["O-", "O+"]);
});

test("AB is the universal plasma donor, O plasma only goes to O", () => {
  for (const recipient of BLOOD_GROUPS) assert.equal(isCompatibleDonor("AB+", recipient, "plasma"), true);
  assert.deepEqual(compatibleDonorGroups("AB-", "plasma"), ["AB-", "AB+"]);
  assert.equal(isCompatibleDonor("O-", "A+", "plasma"), false);
});

test("Rh does not restrict plasma but does restrict platelets", () => {
  assert.equal(isCompatibleDonor("A+", "A-", "plasma"), true);
  assert.equal(isCompatibleDonor("A+", "A-", "platelets"), false);
  assert.equal(isCompatibleDonor("AB-", "A-", "platelets"), true);
});
