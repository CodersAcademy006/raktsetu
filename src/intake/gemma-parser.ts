import { ParsedRequestSchema, type ParsedRequest } from "./request-schema.ts";
import { BLOOD_GROUPS, COMPONENTS } from "../matching/compatibility.ts";
import { knownLocalityNames } from "./geocode.ts";
import { gemmaJson } from "./gemma.ts";
import { mentionedBloodGroups, mentionedNumbers, mentionsLocality } from "./verify.ts";

const SYSTEM_PROMPT = `You extract structured fields from an emergency blood request written by hospital staff.
Return ONLY a JSON object with exactly these keys:
- bloodGroup: one of ${BLOOD_GROUPS.join(", ")}, or null if not clearly stated
- component: one of ${COMPONENTS.join(", ")} (prbc = packed red cells; whole_blood if no component is named)
- units: integer number of units, or null if not stated
- locationText: the locality named in the text, lowercase, ONLY if it is one of: ${knownLocalityNames().join(", ")}; otherwise "unknown"
- urgency: one of critical, urgent, routine (routine if not stated)

Never guess. A missing or unclear blood group or unit count must be null.`;

export type ParseOutcome =
  | { ok: true; request: ParsedRequest }
  | { ok: false; reason: "could_not_parse" | "blood_group_not_stated" | "units_not_stated" | "unknown_location" };

export async function parseEmergencyRequest(rawText: string): Promise<ParseOutcome> {
  const candidate = await gemmaJson(SYSTEM_PROMPT, rawText, 60_000);
  const parsed = ParsedRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    const c = (candidate ?? {}) as Record<string, unknown>;
    if (c.bloodGroup === null) return { ok: false, reason: "blood_group_not_stated" };
    if (c.units === null) return { ok: false, reason: "units_not_stated" };
    return { ok: false, reason: "could_not_parse" };
  }
  const request = parsed.data;
  if (!mentionedBloodGroups(rawText).has(request.bloodGroup)) return { ok: false, reason: "blood_group_not_stated" };
  if (!mentionedNumbers(rawText).has(request.units)) return { ok: false, reason: "units_not_stated" };
  if (!knownLocalityNames().includes(request.locationText) || !mentionsLocality(rawText, request.locationText)) {
    return { ok: false, reason: "unknown_location" };
  }
  return { ok: true, request };
}
