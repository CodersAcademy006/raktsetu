import { Router } from "express";
import { z } from "zod";
import { WorkflowNotFoundError } from "@temporalio/client";
import { getDb, TERMINAL_STATUSES, type DispatchDoc, type DonorDoc, type RequestDoc } from "../db/mongo.ts";
import { getTemporalClient } from "./temporal-client.ts";
import { donorResponseSignal } from "../temporal/workflows.ts";
import { asyncHandler } from "./async-handler.ts";
import { classifyReply } from "../intake/reply-parser.ts";
import { mapsLink } from "../dispatch/message.ts";
import { COMPONENT_LABELS } from "../matching/compatibility.ts";

export const repliesRouter = Router();

// Donor-facing routes. The dispatchId is a random UUID that only that
// donor's message links to, so it is the capability: no login, and it
// exposes only what the donor needs to act (never other donors' data).
repliesRouter.get("/dispatches/:dispatchId", asyncHandler(async (req, res) => {
  const db = await getDb();
  const dispatch = await db.collection<DispatchDoc>("dispatches").findOne({ dispatchId: String(req.params.dispatchId) });
  if (!dispatch) return res.status(404).json({ error: "not_found" });
  const [request, donor] = await Promise.all([
    db.collection<RequestDoc>("requests").findOne({ requestId: dispatch.requestId }),
    db.collection<DonorDoc>("donors").findOne({ donorId: dispatch.donorId }, { projection: { name: 1 } }),
  ]);
  if (!request) return res.status(404).json({ error: "not_found" });
  res.json({
    status: dispatch.status,
    requestStatus: request.status,
    donorName: donor?.name ?? "",
    message: dispatch.message,
    need: `${COMPONENT_LABELS[request.component ?? "whole_blood"]}, ${request.requiredBloodGroup}`,
    units: request.unitsRequested,
    urgency: request.urgency,
    hospitalName: request.hospitalName,
    locationText: request.locationText,
    contactPhone: request.contactPhone,
    mapsUrl: mapsLink(request),
    replyNote: dispatch.replyNote ?? null,
  });
}));

const ReplyBody = z.union([
  z.object({ accepted: z.boolean() }),
  z.object({ text: z.string().trim().min(1).max(500) }),
]);

repliesRouter.post("/dispatches/:dispatchId/reply", asyncHandler(async (req, res) => {
  const body = ReplyBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_body" });
  const dispatchId = String(req.params.dispatchId);

  if ("accepted" in body.data) {
    const result = await recordReply(dispatchId, body.data.accepted);
    return res.status(result.httpStatus).json(result.body);
  }

  // Free-text reply: Gemma classifies it; anything not clearly yes/no stays
  // pending with a note so staff call the donor back.
  const text = body.data.text;
  const c = await classifyReply(text);
  const extra = { replyText: text, replyNote: c.note, ...(c.etaMinutes !== null ? { etaMinutes: c.etaMinutes } : {}) };
  if (c.decision === "unclear") {
    const db = await getDb();
    const updated = await db
      .collection<DispatchDoc>("dispatches")
      .updateOne({ dispatchId, status: "sent" }, { $set: { ...extra, replyNeedsCall: true } });
    if (updated.matchedCount === 0) return res.status(409).json({ error: "already_responded" });
    return res.json({ ok: true, status: "unclear", note: c.note });
  }
  const result = await recordReply(dispatchId, c.decision === "accept", { ...extra, replyNeedsCall: false });
  res.status(result.httpStatus).json({ ...result.body, note: c.note });
}));

export async function recordReply(
  dispatchId: string,
  accepted: boolean,
  extra: Partial<DispatchDoc> = {},
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const db = await getDb();
  const dispatches = db.collection<DispatchDoc>("dispatches");
  const dispatch = await dispatches.findOne({ dispatchId });
  if (!dispatch) return { httpStatus: 404, body: { error: "not_found" } };

  const request = await db.collection<RequestDoc>("requests").findOne({ requestId: dispatch.requestId });
  if (!request || TERMINAL_STATUSES.includes(request.status)) {
    await dispatches.updateOne({ dispatchId, status: "sent" }, { $set: { status: "expired" } });
    return { httpStatus: 409, body: { error: "request_closed", status: request?.status ?? "UNKNOWN" } };
  }

  // Conditional update: only a still-pending dispatch can be answered, so a
  // double tap or a replayed webhook can't flip an answer.
  const status = accepted ? "accepted" : "declined";
  const updated = await dispatches.updateOne({ dispatchId, status: "sent" }, { $set: { status, respondedAt: new Date(), ...extra } });
  if (updated.matchedCount === 0) {
    const current = await dispatches.findOne({ dispatchId });
    return { httpStatus: 409, body: { error: "already_responded", status: current?.status } };
  }

  try {
    const client = await getTemporalClient();
    await client.workflow.getHandle(dispatch.requestId).signal(donorResponseSignal, { donorId: dispatch.donorId, accepted });
  } catch (err) {
    if (!(err instanceof WorkflowNotFoundError)) throw err;
    // Workflow finished between our status read and the signal.
    await dispatches.updateOne({ dispatchId }, { $set: { status: "expired" } });
    return { httpStatus: 409, body: { error: "request_closed" } };
  }

  if (accepted) {
    await db.collection<RequestDoc>("requests").updateOne(
      { requestId: dispatch.requestId },
      { $addToSet: { acceptedDonorIds: dispatch.donorId } },
    );
  }
  return { httpStatus: 200, body: { ok: true, status } };
}
