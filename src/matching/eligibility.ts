// Whole-blood donor eligibility, per India's NBTC donor selection guidelines
// (2017): age 18-65, weight >= 45 kg, and a minimum gap since the last
// donation of 90 days for men and 120 days for women. Deterministic code,
// never a model's judgment. Hemoglobin and health screening happen at the
// donation site and are out of scope here.

export type Sex = "M" | "F";

export const COOLDOWN_DAYS: Record<Sex, number> = { M: 90, F: 120 };
export const MIN_AGE_YEARS = 18;
export const MAX_AGE_YEARS = 65;
export const MIN_WEIGHT_KG = 45;

export interface EligibilityFields {
  sex: Sex;
  dateOfBirth: Date;
  weightKg: number;
  lastDonationDate: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function yearsBefore(now: Date, years: number): Date {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

// Bounds shared by isEligible() and eligibilityQuery() so the in-code check
// and the database filter can never disagree.
function bounds(now: Date) {
  return {
    bornOnOrBefore: yearsBefore(now, MIN_AGE_YEARS), // at least 18 today
    bornAfter: yearsBefore(now, MAX_AGE_YEARS + 1), // not yet 66 today
    lastDonationOnOrBefore: {
      M: new Date(now.getTime() - COOLDOWN_DAYS.M * DAY_MS),
      F: new Date(now.getTime() - COOLDOWN_DAYS.F * DAY_MS),
    },
  };
}

export function isEligible(donor: EligibilityFields, now: Date = new Date()): boolean {
  const b = bounds(now);
  if (donor.dateOfBirth > b.bornOnOrBefore || donor.dateOfBirth <= b.bornAfter) return false;
  if (donor.weightKg < MIN_WEIGHT_KG) return false;
  return donor.lastDonationDate === null || donor.lastDonationDate <= b.lastDonationOnOrBefore[donor.sex];
}

// The same rule as a MongoDB filter, so eligibility is applied before the
// query's limit and a batch is never filled with donors who get dropped later.
export function eligibilityQuery(now: Date = new Date()): Record<string, unknown> {
  const b = bounds(now);
  return {
    dateOfBirth: { $lte: b.bornOnOrBefore, $gt: b.bornAfter },
    weightKg: { $gte: MIN_WEIGHT_KG },
    $or: [
      { lastDonationDate: null },
      { sex: "M", lastDonationDate: { $lte: b.lastDonationOnOrBefore.M } },
      { sex: "F", lastDonationDate: { $lte: b.lastDonationOnOrBefore.F } },
    ],
  };
}

export const ESCALATION_RADII_KM = [5, 10, 25, 50];
