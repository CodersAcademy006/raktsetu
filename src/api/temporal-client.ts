import { Connection, Client } from "@temporalio/client";
import { temporalConnectionOptions } from "../temporal/connection.ts";

export { TASK_QUEUE } from "../temporal/connection.ts";

let clientPromise: Promise<Client> | null = null;

export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    const { namespace, ...conn } = temporalConnectionOptions();
    clientPromise = Connection.connect(conn)
      .then((connection) => new Client({ connection, namespace }))
      .catch((err) => {
        clientPromise = null; // retry on the next call instead of caching a failure
        throw err;
      });
  }
  return clientPromise;
}
