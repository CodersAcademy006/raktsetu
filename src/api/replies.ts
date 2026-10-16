import { Router } from "express";
import { z } from "zod";
import { WorkflowNotFoundError } from "@temporalio/client";
import { getDb, TERMINAL_STATUSES, type DispatchDoc, type RequestDoc } from "../db/mongo.ts";
import { getTemporalClient } from "./temporal-client.ts";
import { donorResponseSignal } from "../temporal/workflows.ts";
import { asyncHandler } from "./async-handler.ts";

export const repliesRouter = Router();

const ReplyBody = z.object({ accepted: z.boolean() });

// Donor-facing: the dispatchId is a random UUID only that donor's message
// links to, so it doubles as the capability for replying. Stands in for the
// inbound WhatsApp webhook a real provider would call.
repliesRouter.post("/dispatches/:dispatchId/reply", asyncHandler(async (req, res) => {
  const body = ReplyBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_body" });
  const result = await recordReply(String(req.params.dispatchId), body.data.accepted);
  res.status(result.httpStatus).json(result.body);
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
