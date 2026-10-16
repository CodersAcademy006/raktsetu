import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, type RequestDoc, type DispatchDoc, type WorkflowEventDoc, type DonorDoc } from "../db/mongo.ts";
import { parseEmergencyRequest } from "../intake/gemma-parser.ts";
import { geocode } from "../intake/geocode.ts";
import { getTemporalClient, TASK_QUEUE } from "./temporal-client.ts";
import { EmergencyRequestWorkflow } from "../temporal/workflows.ts";
import { BLOOD_GROUPS } from "../matching/compatibility.ts";
import { asyncHandler } from "./async-handler.ts";

export const requestsRouter = Router();

const FreeTextBody = z.object({
  rawText: z.string().min(3),
  targetDonorAcceptances: z.number().int().min(1).optional(),
});

// The guided (MCQ) path: location comes from the browser's own geolocation,
// not a parsed place name, and blood group/units/urgency come from button
// answers, not free text -- so there's nothing here for Gemma to parse.
const GuidedBody = z.object({
  bloodGroup: z.enum(BLOOD_GROUPS),
  units: z.number().int().min(1).max(10),
  urgency: z.enum(["critical", "urgent", "routine"]),
  targetDonorAcceptances: z.number().int().min(1).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  requesterName: z.string().min(1).max(100).optional(),
  contactPhone: z.string().min(1).max(20).optional(),
});

async function startRequest(doc: RequestDoc): Promise<void> {
  const db = await getDb();
  await db.collection<RequestDoc>("requests").insertOne(doc);

  const client = await getTemporalClient();
  const responseWindowMs = Number(process.env.RAKTSETU_RESPONSE_WINDOW_MS ?? 15_000);
  await client.workflow.start(EmergencyRequestWorkflow, {
    workflowId: doc.requestId,
    taskQueue: TASK_QUEUE,
    args: [doc.requestId, responseWindowMs],
  });
}

requestsRouter.post("/requests", asyncHandler(async (req, res) => {
  const isGuided = "bloodGroup" in (req.body ?? {});

  if (isGuided) {
    const parsedBody = GuidedBody.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: "invalid_body", details: parsedBody.error.flatten() });
    }
    const { bloodGroup, units, urgency, targetDonorAcceptances, lat, lng, requesterName, contactPhone } = parsedBody.data;
    const doc: RequestDoc = {
      requestId: randomUUID(),
      requiredBloodGroup: bloodGroup,
      unitsRequested: units,
      targetDonorAcceptances: targetDonorAcceptances ?? units,
      location: { type: "Point", coordinates: [lng, lat] },
      locationText: `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      urgency,
      status: "MATCHING",
      currentRadiusKm: null,
      acceptedDonorIds: [],
      contactedDonorIds: [],
      createdAt: new Date(),
      ...(requesterName ? { requesterName } : {}),
      ...(contactPhone ? { contactPhone } : {}),
    };
    await startRequest(doc);
    return res.status(201).json(doc);
  }

  const parsedBody = FreeTextBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "invalid_body", details: parsedBody.error.flatten() });
  }

  const parsed = await parseEmergencyRequest(parsedBody.data.rawText);
  if (!parsed) {
    // Gemma parse failed or was ambiguous: never guess silently, hand it back
    // to staff for the manual form instead of auto-filling blood group/units.
    return res.status(422).json({ error: "could_not_parse", message: "Please use the manual form for this request." });
  }

  const coords = geocode(parsed.locationText);
  if (!coords) {
    return res.status(422).json({ error: "unknown_location", locationText: parsed.locationText });
  }

  const doc: RequestDoc = {
    requestId: randomUUID(),
    requiredBloodGroup: parsed.bloodGroup,
    unitsRequested: parsed.units,
    targetDonorAcceptances: parsedBody.data.targetDonorAcceptances ?? parsed.units,
    location: { type: "Point", coordinates: coords },
    locationText: parsed.locationText,
    urgency: parsed.urgency,
    status: "MATCHING",
    currentRadiusKm: null,
    acceptedDonorIds: [],
    contactedDonorIds: [],
    createdAt: new Date(),
  };

  await startRequest(doc);
  res.status(201).json(doc);
}));

requestsRouter.get("/requests/:id/state", asyncHandler(async (req, res) => {
  const db = await getDb();
  const requestId = req.params.id;
  const [request, dispatches, events] = await Promise.all([
    db.collection<RequestDoc>("requests").findOne({ requestId }),
    db.collection<DispatchDoc>("dispatches").find({ requestId }).sort({ createdAt: 1 }).toArray(),
    db.collection<WorkflowEventDoc>("workflow_events").find({ requestId }).sort({ timestamp: 1 }).toArray(),
  ]);

  if (!request) return res.status(404).json({ error: "not_found" });

  const donorIds = [...new Set(dispatches.map((d) => d.donorId))];
  const donors = await db.collection<DonorDoc>("donors").find({ donorId: { $in: donorIds } }).toArray();
  const donorsById = Object.fromEntries(donors.map((d) => [d.donorId, { name: d.name, bloodGroup: d.bloodGroup }]));

  res.json({ request, dispatches, events, donorsById });
}));

requestsRouter.get("/requests", asyncHandler(async (_req, res) => {
  const db = await getDb();
  const all = await db.collection<RequestDoc>("requests").find().sort({ createdAt: -1 }).limit(50).toArray();
  res.json(all);
}));
