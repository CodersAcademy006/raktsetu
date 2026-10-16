import { parseEmergencyRequest } from "../src/intake/gemma-parser.ts";

const samples = [
  "O+ blood required, 2 units, Andheri, urgent accident case",
  "Need AB negative, 1 unit, patient in Thane, not critical but needed this week",
  "critical: B+ x3 units, near Powai",
  // Must all be refused, never guessed:
  "O+ needed urgently, 2 units, AIIMS Delhi",
  "blood needed for accident patient, 2 units, Andheri",
  "A positive blood needed in Bandra asap",
];

for (const s of samples) {
  const start = Date.now();
  const result = await parseEmergencyRequest(s);
  console.log(`"${s}" ->`, result, `(${Date.now() - start}ms)`);
}
