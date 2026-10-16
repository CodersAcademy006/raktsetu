import express, { type ErrorRequestHandler } from "express";
import { getDb, ensureIndexes } from "../db/mongo.ts";
import { requestsRouter } from "./requests.ts";
import { repliesRouter } from "./replies.ts";
import { nearbyRouter } from "./nearby.ts";
import { requireAccessCode, rateLimit, securityHeaders } from "./guard.ts";

const app = express();
app.set("trust proxy", 1); // behind one reverse proxy (tunnel / hosting edge), so req.ip is the client
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(express.json({ limit: "10kb" }));
app.use(express.static(new URL("../../apps/web", import.meta.url).pathname));
app.post("*", rateLimit(30));
app.use(["/requests", "/nearby"], requireAccessCode);
app.use(requestsRouter);
app.use(repliesRouter);
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
