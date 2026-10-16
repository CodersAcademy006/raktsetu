import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb, type RequestDoc, type DispatchDoc, type WorkflowEventDoc, type DonorDoc } from "../db/mongo.ts";
import { parseEmergencyRequest } from "../intake/gemma-parser.ts";
import { geocode, nearestLocality } from "../intake/geocode.ts";
import { getTemporalClient, TASK_QUEUE } from "./temporal-client.ts";
import { EmergencyRequestWorkflow } from "../temporal/workflows.ts";
import { BLOOD_GROUPS, COMPONENTS } from "../matching/compatibility.ts";
import { asyncHandler } from "./async-handler.ts";

export const requestsRouter = Router();

// Who is asking and where donors should go. Required on both intake paths:
// a donor who accepts needs a hospital to walk into and a number to call.
const Requester = {
  hospitalName: z.string().trim().min(2).max(120),
  contactPhone: z.string().regex(/^\+?[0-9][0-9 -]{6,18}$/, "invalid phone number"),
  requesterName: z.string().trim().min(1).max(100).optional(),
};

const FreeTextBody = z.object({
  ...Requester,
  rawText: z.string().min(3),
  targetDonorAcceptances: z.number().int().min(1).optional(),
});

// The guided (MCQ) path: location comes from the browser's own geolocation,
// not a parsed place name, and blood group/units/urgency come from button
// answers, not free text -- so there's nothing here for Gemma to parse.
const GuidedBody = z.object({
  bloodGroup: z.enum(BLOOD_GROUPS),
  component: z.enum(COMPONENTS).default("whole_blood"),
  units: z.number().int().min(1).max(10),
  urgency: z.enum(["critical", "urgent", "routine"]),
  targetDonorAcceptances: z.number().int().min(1).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  ...Requester,
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

const PARSE_MESSAGES = {
  could_not_parse: "Couldn't read that request. Use the guided questions instead.",
  blood_group_not_stated: "Say the blood group explicitly, e.g. \"O+\" or \"B negative\".",
  units_not_stated: "Say how many units are needed, e.g. \"2 units\".",
  unknown_location: "Name a supported locality, or share location with the guided flow.",
} as const;

requestsRouter.post("/requests", asyncHandler(async (req, res) => {
  const isGuided = "bloodGroup" in (req.body ?? {});

  if (isGuided) {
    const parsedBody = GuidedBody.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: "invalid_body", details: parsedBody.error.flatten() });
    }
    const { bloodGroup, component, units, urgency, targetDonorAcceptances, lat, lng, hospitalName, contactPhone, requesterName } = parsedBody.data;
    const doc: RequestDoc = {
      requestId: randomUUID(),
      requiredBloodGroup: bloodGroup,
      component,
      unitsRequested: units,
      targetDonorAcceptances: targetDonorAcceptances ?? units,
      location: { type: "Point", coordinates: [lng, lat] },
      locationText: nearestLocality([lng, lat]) ?? `${lat.toFixed(3)}, ${lng.toFixed(3)}`,
      urgency,
      status: "MATCHING",
      currentRadiusKm: null,
      acceptedDonorIds: [],
      contactedDonorIds: [],
      createdAt: new Date(),
      hospitalName,
      contactPhone,
      ...(requesterName ? { requesterName } : {}),
    };
    await startRequest(doc);
    return res.status(201).json(doc);
  }

  const parsedBody = FreeTextBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "invalid_body", details: parsedBody.error.flatten() });
  }

  // Anything Gemma could not take literally from the text goes back to staff
  // with a specific reason; nothing is guessed.
  const outcome = await parseEmergencyRequest(parsedBody.data.rawText);
  if (!outcome.ok) {
    return res.status(422).json({ error: outcome.reason, message: PARSE_MESSAGES[outcome.reason] });
  }
  const parsed = outcome.request;
  const coords = geocode(parsed.locationText)!;

  const doc: RequestDoc = {
    requestId: randomUUID(),
    requiredBloodGroup: parsed.bloodGroup,
    component: parsed.component,
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
    hospitalName: parsedBody.data.hospitalName,
    contactPhone: parsedBody.data.contactPhone,
    ...(parsedBody.data.requesterName ? { requesterName: parsedBody.data.requesterName } : {}),
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
  // List view never needs the callback number; it's only returned for the one request being viewed.
  const all = await db
    .collection<RequestDoc>("requests")
    .find({}, { projection: { _id: 0, contactPhone: 0 } })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  res.json(all);
}));
