import type { DonorDoc, RequestDoc } from "../db/mongo.ts";

export interface DispatchMessage {
  donor: DonorDoc;
  request: RequestDoc;
  dispatchId: string;
  batchNo: number;
  text: string;
}

export interface NotificationProvider {
  readonly name: string;
  send(message: DispatchMessage): Promise<{ status: "sent" | "failed" }>;
}
