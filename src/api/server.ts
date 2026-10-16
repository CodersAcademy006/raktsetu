import express from "express";
import { getDb, ensureIndexes } from "../db/mongo.ts";
import { requestsRouter } from "./requests.ts";
import { demoRepliesRouter } from "./demo-replies.ts";

const app = express();
app.use(express.json());
app.use(express.static(new URL("../../apps/web", import.meta.url).pathname));
app.use(requestsRouter);
app.use(demoRepliesRouter);

const port = Number(process.env.PORT ?? 3000);

async function main() {
  const db = await getDb();
  await ensureIndexes(db);
  app.listen(port, () => console.log(`RaktSetu API listening on :${port}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
