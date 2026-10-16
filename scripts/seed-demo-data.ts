import { randomUUID } from "node:crypto";
import { getDb, ensureIndexes, closeDb, type DonorDoc, type BloodBankDoc } from "../src/db/mongo.ts";
import { BLOOD_GROUPS, type BloodGroup } from "../src/matching/compatibility.ts";
import type { Sex } from "../src/matching/eligibility.ts";
import { knownLocalityNames, geocode } from "../src/intake/geocode.ts";

// Approximate real-world blood type distribution (India-weighted).
const BLOOD_GROUP_WEIGHTS: Record<BloodGroup, number> = {
  "O+": 37.1, "B+": 32.3, "A+": 20.8, "AB+": 6.4,
  "O-": 1.1, "B-": 1.0, "A-": 0.7, "AB-": 0.2,
};

function weightedRandomBloodGroup(): BloodGroup {
  const total = Object.values(BLOOD_GROUP_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const bg of BLOOD_GROUPS) {
    r -= BLOOD_GROUP_WEIGHTS[bg];
    if (r <= 0) return bg;
  }
  return "O+";
}

// Dense cluster: Andheri/Bandra/Powai/Dadar/Kurla area (close to the demo request's locality).
const DENSE_CLUSTER_CENTER: [number, number] = [72.869, 19.12];
// Far cluster: Pune/Nashik, >100km away, used to exercise radius escalation / exhausted pool.
const FAR_LOCATIONS: [number, number][] = [[73.8567, 18.5204], [73.7898, 19.9975]];

function jitter([lng, lat]: [number, number], spreadKm: number): [number, number] {
  const degPerKm = 1 / 111; // rough conversion, fine for a demo-radius scale
  return [lng + (Math.random() - 0.5) * 2 * spreadKm * degPerKm, lat + (Math.random() - 0.5) * 2 * spreadKm * degPerKm];
}

// A realistic mix, including some donors the eligibility rule must exclude
// (under 18 / over 65 / under 45 kg), so the filter is exercised by real data.
function randomProfile(): { sex: Sex; dateOfBirth: Date; weightKg: number } {
  const ageYears = 17 + Math.random() * 52; // 17-69
  return {
    sex: Math.random() < 0.7 ? "M" : "F",
    dateOfBirth: new Date(Date.now() - ageYears * 365.25 * 24 * 60 * 60 * 1000),
    weightKg: Math.round(42 + Math.random() * 50),
  };
}

function randomLastDonation(): Date | null {
  if (Math.random() < 0.15) return null; // never donated before
  const daysAgo = Math.floor(Math.random() * 400);
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
}

// Blood banks sit only in the dense Mumbai-metro cluster, never in the far
// cluster (Pune/Nashik) -- this is deliberate. It's the same gap the RakhtKhoj
// pitch named: real blood banks are concentrated in cities, so a patient far
// from one has no bank-based option at all, only the donor network.
const FAR_LOCALITY_NAMES = new Set(["pune", "nashik"]);

async function seedBloodBanks(db: Awaited<ReturnType<typeof getDb>>) {
  const banks = db.collection<BloodBankDoc>("blood_banks");
  await banks.deleteMany({ synthetic: true });

  const docs: BloodBankDoc[] = knownLocalityNames()
    .filter((name) => !FAR_LOCALITY_NAMES.has(name))
    .map((name, i) => {
      const coords = geocode(name)!;
      return {
        bankId: randomUUID(),
        name: `${name[0].toUpperCase()}${name.slice(1)} Blood Bank`,
        location: { type: "Point" as const, coordinates: coords },
        phone: `+91-2${(20000000 + i).toString().padStart(8, "0")}`,
        synthetic: true,
      };
    });

  await banks.insertMany(docs);
  console.log(`Seeded ${docs.length} synthetic blood banks (none in the far cluster, by design).`);
}

async function main() {
  const db = await getDb();
  await ensureIndexes(db);
  await seedBloodBanks(db);
  const donors = db.collection<DonorDoc>("donors");
  await donors.deleteMany({ synthetic: true });

  const docs: DonorDoc[] = [];

  // 420 donors spread densely within ~20km of the demo locality cluster -> first request resolves fast.
  for (let i = 0; i < 420; i++) {
    const [lng, lat] = jitter(DENSE_CLUSTER_CENTER, 18);
    docs.push({
      donorId: randomUUID(),
      name: `Donor ${i + 1}`,
      bloodGroup: weightedRandomBloodGroup(),
      location: { type: "Point", coordinates: [lng, lat] },
      ...randomProfile(),
      lastDonationDate: randomLastDonation(),
      optInStatus: true,
      active: true,
      synthetic: true,
      phone: `+91-9${(100000000 + i).toString().padStart(9, "0")}`,
    });
  }

  // 40 donors only in the far cluster -> a request needing them must escalate radius through the full ladder.
  for (let i = 0; i < 40; i++) {
    const center = FAR_LOCATIONS[i % FAR_LOCATIONS.length];
    const [lng, lat] = jitter(center, 10);
    docs.push({
      donorId: randomUUID(),
      name: `Far Donor ${i + 1}`,
      bloodGroup: weightedRandomBloodGroup(),
      location: { type: "Point", coordinates: [lng, lat] },
      ...randomProfile(),
      lastDonationDate: randomLastDonation(),
      optInStatus: true,
      active: true,
      synthetic: true,
      phone: `+91-9${(200000000 + i).toString().padStart(9, "0")}`,
    });
  }

  await donors.insertMany(docs);
  console.log(`Seeded ${docs.length} synthetic donors (dense: 420, far: 40).`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
