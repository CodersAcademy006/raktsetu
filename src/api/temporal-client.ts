import { Connection, Client } from "@temporalio/client";

let client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (!client) {
    const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
    client = new Client({ connection });
  }
  return client;
}

export const TASK_QUEUE = "raktsetu";
