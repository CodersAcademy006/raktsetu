import type { RequestDoc } from "../db/mongo.ts";
import { COMPONENT_LABELS } from "../matching/compatibility.ts";

export function mapsLink(request: Pick<RequestDoc, "location">): string {
  const [lng, lat] = request.location.coordinates;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

// The facts a donor needs to act, built only from the request record so
// nothing in it can be invented: what, how much, where, who to call.
export function outreachFacts(request: RequestDoc): string {
  const what = `${COMPONENT_LABELS[request.component ?? "whole_blood"]}, ${request.requiredBloodGroup}`;
  return [
    `Needed: ${what}, ${request.unitsRequested} unit(s), ${request.urgency}`,
    `Where: ${request.hospitalName ?? "Hospital"}, near ${request.locationText}`,
    `Map: ${mapsLink(request)}`,
    request.contactPhone ? `Call: ${request.contactPhone}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
