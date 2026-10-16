import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "./activities.ts";
import { temporalConnectionOptions, TASK_QUEUE } from "./connection.ts";

async function main() {
  const { namespace, ...conn } = temporalConnectionOptions();
  const connection = await NativeConnection.connect(conn);
  const worker = await Worker.create({
    connection,
    namespace,
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    activities,
    taskQueue: TASK_QUEUE,
  });
  console.log(`RaktSetu Temporal worker running on task queue "${TASK_QUEUE}" (namespace ${namespace})`);
  await worker.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
