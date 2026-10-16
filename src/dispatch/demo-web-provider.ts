import { randomUUID } from "node:crypto";
import { getDb, type DispatchDoc } from "../db/mongo.ts";
import type { DispatchMessage, NotificationProvider } from "./provider.ts";

// Simulates WhatsApp delivery at the console boundary: stores the message as a
// "dispatch" record the web UI polls and renders with Accept/Decline controls.
// No real message leaves the server. Swapping in a real WhatsApp Cloud API
// provider later means implementing NotificationProvider again, nothing else
// in matching or the workflow changes.
export class DemoWebProvider implements NotificationProvider {
  readonly name = "demo-web" as const;

  async send(message: DispatchMessage): Promise<{ status: "sent" | "failed" }> {
    const db = await getDb();
    const doc: DispatchDoc = {
      dispatchId: randomUUID(),
      requestId: message.request.requestId,
      donorId: message.donor.donorId,
      batchNo: message.batchNo,
      provider: "demo-web",
      message: message.text,
      status: "sent",
      createdAt: new Date(),
    };
    // Upsert on (request, donor) so an activity retry never messages a donor twice.
    await db
      .collection<DispatchDoc>("dispatches")
      .updateOne({ requestId: doc.requestId, donorId: doc.donorId }, { $setOnInsert: doc }, { upsert: true });
    return { status: "sent" };
  }
}
