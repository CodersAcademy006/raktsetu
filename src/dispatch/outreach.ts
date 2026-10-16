import type { RequestDoc } from "../db/mongo.ts";
import { COMPONENT_LABELS } from "../matching/compatibility.ts";
import { gemmaChat } from "../intake/gemma.ts";

export const FALLBACK_OPENER = "A patient near you urgently needs blood you can give. If you can come today, please accept below.";

const SYSTEM = `You write the opening line of an urgent SMS asking a registered volunteer blood donor in India to come and donate.
Rules: one or two short sentences, under 35 words, warm and direct, plain English.
Do NOT include any numbers, addresses, hospital names, phone numbers, links or the donor's name; those are added separately.
Output only the message text.`;

// Gemma drafts the human part of the message once per batch; the facts block
// (what, where, who to call) is appended from the record by the caller.
// Drafts containing digits, URLs or too many words are rejected, since that
// is where a model would invent a detail that sends a donor to the wrong place.
export async function draftOpener(request: RequestDoc): Promise<{ text: string; source: "gemma" | "fallback" }> {
  const brief = `Need: ${COMPONENT_LABELS[request.component ?? "whole_blood"]} ${request.requiredBloodGroup}. Urgency: ${request.urgency}. Batch reaching nearby donors.`;
  const draft = await gemmaChat(SYSTEM, brief, { timeoutMs: 20_000 });
  return isSafeOpener(draft) ? { text: draft!.replace(/^["']|["']$/g, ""), source: "gemma" } : { text: FALLBACK_OPENER, source: "fallback" };
}

export function isSafeOpener(text: string | null): boolean {
  if (!text) return false;
  if (/\d|https?:|www\.|@/i.test(text)) return false;
  const words = text.split(/\s+/).length;
  return words >= 5 && words <= 45;
}
