import { Router } from "express";
import { z } from "zod";
import { getDb, type DispatchDoc } from "../db/mongo.ts";
import { getTemporalClient } from "./temporal-client.ts";
import { donorResponseSignal } from "../temporal/workflows.ts";

export const demoRepliesRouter = Router();

const RespondBody = z.object({
  donorId: z.string().min(1),
  accepted: z.boolean(),
});

// Called by the donor-simulator UI's Accept/Decline buttons. Labeled "demo"
// because this stands in for a real WhatsApp webhook; the validation and
// signal logic here is exactly what a real inbound provider would need.
demoRepliesRouter.post("/requests/:id/respond", async (req, res) => {
  const requestId = req.params.id;
  const body = RespondBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "invalid_body" });

  const db = await getDb();
  const dispatch = await db.collection<DispatchDoc>("dispatches").findOne({ requestId, donorId: body.data.donorId });

  if (!dispatch) {
    return res.status(404).json({ error: "invalid_donor_response", message: "This donor was never dispatched for this request." });
  }
  if (dispatch.status !== "sent") {
    return res.status(409).json({ error: "already_responded", status: dispatch.status });
  }

  await db.collection<DispatchDoc>("dispatches").updateOne(
    { dispatchId: dispatch.dispatchId },
    { $set: { status: body.data.accepted ? "accepted" : "declined" } },
  );

  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(requestId);
  await handle.signal(donorResponseSignal, { donorId: body.data.donorId, accepted: body.data.accepted });

  res.json({ ok: true });
});
