import { z } from "zod";
import { BLOOD_GROUPS, COMPONENTS } from "../matching/compatibility.ts";

export const ParsedRequestSchema = z.object({
  bloodGroup: z.enum(BLOOD_GROUPS),
  component: z.enum(COMPONENTS).default("whole_blood"),
  units: z.number().int().min(1).max(10),
  locationText: z.string().min(2),
  urgency: z.enum(["critical", "urgent", "routine"]),
});

export type ParsedRequest = z.infer<typeof ParsedRequestSchema>;
