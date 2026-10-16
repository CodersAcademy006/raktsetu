import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "./activities.ts";

const TASK_QUEUE = "raktsetu";

async function main() {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" });
  const worker = await Worker.create({
    connection,
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
    taskQueue: TASK_QUEUE,
  });
  console.log(`RaktSetu Temporal worker running on task queue "${TASK_QUEUE}"`);
  await worker.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
