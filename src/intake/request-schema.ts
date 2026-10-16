import { z } from "zod";
import { BLOOD_GROUPS } from "../matching/compatibility.ts";

export const ParsedRequestSchema = z.object({
  bloodGroup: z.enum(BLOOD_GROUPS),
  units: z.number().int().min(1).max(10),
  locationText: z.string().min(2),
  urgency: z.enum(["critical", "urgent", "routine"]),
});

export type ParsedRequest = z.infer<typeof ParsedRequestSchema>;
