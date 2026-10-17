import { z } from "zod";
import { gemmaJson } from "./gemma.ts";

const SYSTEM = `A volunteer blood donor in India was asked to come and donate today. Classify their reply.
Return ONLY JSON: {"decision": "accept" | "decline" | "unclear", "etaMinutes": integer or null, "note": string}
- accept: they clearly say they will come today (any language, incl. Hinglish).
- decline: they clearly cannot come or are not fit (illness, medication, recent donation, travel).
- unclear: anything conditional, a question, or ambiguous.
- etaMinutes: minutes until they arrive if they say (e.g. "in half an hour" = 30), else null.
- note: under 15 words, what the hospital should know, in English.`;

const Classified = z.object({
  decision: z.enum(["accept", "decline", "unclear"]),
  etaMinutes: z.number().int().min(0).max(24 * 60).nullable().catch(null),
  note: z.string().max(200).catch(""),
});
export type ReplyClassification = z.infer<typeof Classified>;

// A negation or a condition anywhere in the reply vetoes an "accept": a donor
// wrongly marked as coming is worse than one more phone call. Seen in testing:
// the model read "Can I come after 6pm instead?" as an accept.
const NEGATION = /\b(no|not|can'?t|cannot|won'?t|unable|sorry|busy|sick|fever|nahi|nahin|nai|mat)\b/i;
const CONDITIONAL = /\?|\b(if|maybe|perhaps|after|instead|later|tomorrow|kal|baad|try|might|depends)\b/i;

export async function classifyReply(text: string): Promise<ReplyClassification> {
  const parsed = Classified.safeParse(await gemmaJson(SYSTEM, text, 30_000));
  if (!parsed.success) return { decision: "unclear", etaMinutes: null, note: "Could not read the reply automatically; call the donor." };
  return applyAcceptVeto(text, parsed.data);
}

export function applyAcceptVeto(text: string, c: ReplyClassification): ReplyClassification {
  return c.decision === "accept" && (NEGATION.test(text) || CONDITIONAL.test(text)) ? { ...c, decision: "unclear" } : c;
}
