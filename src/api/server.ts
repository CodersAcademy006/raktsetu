import express, { type ErrorRequestHandler } from "express";
import { getDb, ensureIndexes } from "../db/mongo.ts";
import { requestsRouter } from "./requests.ts";
import { demoRepliesRouter } from "./demo-replies.ts";
import { nearbyRouter } from "./nearby.ts";

const app = express();
app.use(express.json());
app.use(express.static(new URL("../../apps/web", import.meta.url).pathname));
app.use(requestsRouter);
app.use(demoRepliesRouter);
app.use(nearbyRouter);

// Last-resort: a Mongo/Temporal/Gemma call anywhere above can fail (e.g. a
// transient network drop). Every route is wrapped in asyncHandler so the
// rejection lands here instead of becoming an unhandled rejection that
// kills the process -- a 500 to one caller beats taking the whole server down.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
};
app.use(errorHandler);

// Belt-and-suspenders: log and keep running rather than let Node's default
// "crash on unhandled rejection" behavior take down a live demo.
process.on("unhandledRejection", (err) => console.error("unhandledRejection", err));

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
