import { ParsedRequestSchema, type ParsedRequest } from "./request-schema.ts";
import { BLOOD_GROUPS, COMPONENTS } from "../matching/compatibility.ts";
import { knownLocalityNames } from "./geocode.ts";

const SYSTEM_PROMPT = `You extract structured fields from an emergency blood request written by hospital staff.
Return ONLY a JSON object with exactly these keys:
- bloodGroup: one of ${BLOOD_GROUPS.join(", ")}
- component: one of ${COMPONENTS.join(", ")} (prbc = packed red cells; use whole_blood if no component is named)
- units: integer number of units needed
- locationText: the locality name mentioned, matching one of: ${knownLocalityNames().join(", ")} (pick the closest match, lowercase)
- urgency: one of critical, urgent, routine

If any field is missing or ambiguous in the input, make your best reasonable guess but never invent a blood group that was not stated or implied.`;

export async function parseEmergencyRequest(rawText: string): Promise<ParsedRequest | null> {
  const baseUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const model = process.env.GEMMA_MODEL ?? "gemma3:4b";

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: rawText },
      ],
    }),
  });

  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  const raw = data.message?.content;
  if (!raw) return null;

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = ParsedRequestSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
