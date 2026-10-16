// Runs the real EmergencyRequestWorkflow on Temporal's time-skipping test
// server with in-memory activities, so the escalation ladder, early wake-up
// and fulfilment paths are proven without Mongo or waiting on real timers.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, Runtime, DefaultLogger } from "@temporalio/worker";
import { EmergencyRequestWorkflow, donorResponseSignal } from "../src/temporal/workflows.ts";

let env: TestWorkflowEnvironment;
before(async () => {
  Runtime.install({ logger: new DefaultLogger("WARN") });
  env = await TestWorkflowEnvironment.createTimeSkipping();
});
after(async () => {
  await env?.teardown();
});

// donorsByRadius: which donor ids become reachable at each radius.
function fakeActivities(donorsByRadius: Record<number, string[]>, target = 1) {
  const contacted = new Set<string>();
  const calls = { radii: [] as number[], batches: [] as string[][], final: "" };
  return {
    calls,
    activities: {
      async getRequest() {
        return { targetDonorAcceptances: target };
      },
      async setRequestRadius(_id: string, r: number) {
        calls.radii.push(r);
      },
      async findCandidates(_id: string, r: number) {
        const reachable = Object.entries(donorsByRadius)
          .filter(([radius]) => Number(radius) <= r)
          .flatMap(([, ids]) => ids)
          .filter((id) => !contacted.has(id));
        return reachable.slice(0, 2); // batch size 2
      },
      async dispatchBatch(_id: string, ids: string[]) {
        ids.forEach((id) => contacted.add(id));
        calls.batches.push(ids);
      },
      async finalizeRequest(_id: string, status: string) {
        calls.final = status;
      },
    },
  };
}

async function run(fake: ReturnType<typeof fakeActivities>, drive?: (handle: any) => Promise<void>) {
  const taskQueue = `test-${Math.random()}`;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: new URL("../src/temporal/workflows.ts", import.meta.url).pathname,
    activities: fake.activities,
  });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start(EmergencyRequestWorkflow, {
      taskQueue,
      workflowId: `wf-${Math.random()}`,
      args: ["req-1", 60_000],
    });
    if (drive) await drive(handle);
    await handle.result();
  });
}

test("nobody answers: every radius is tried, then EXHAUSTED", async () => {
  const fake = fakeActivities({ 5: ["a"], 25: ["b"] });
  await run(fake);
  assert.deepEqual(fake.calls.radii, [5, 10, 25, 50]);
  assert.deepEqual(fake.calls.batches, [["a"], ["b"]]);
  assert.equal(fake.calls.final, "EXHAUSTED");
});

test("all donors at a radius are batched before the radius widens", async () => {
  const fake = fakeActivities({ 5: ["a", "b", "c", "d", "e"] });
  await run(fake);
  assert.deepEqual(fake.calls.batches, [["a", "b"], ["c", "d"], ["e"]]);
  assert.deepEqual(fake.calls.radii, [5, 10, 25, 50]);
});

test("an accept meeting the target finishes FULFILLED", async () => {
  const fake = fakeActivities({ 5: ["a", "b"], 10: ["c"] });
  await run(fake, async (handle) => {
    await waitFor(() => fake.calls.batches.length === 1);
    await handle.signal(donorResponseSignal, { donorId: "b", accepted: true });
  });
  assert.equal(fake.calls.final, "FULFILLED");
  assert.deepEqual(fake.calls.radii, [5]);
});

test("a whole batch declining moves on without waiting out the window", async () => {
  const fake = fakeActivities({ 5: ["a", "b"], 10: ["c"] });
  const started = Date.now();
  await run(fake, async (handle) => {
    await waitFor(() => fake.calls.batches.length === 1);
    await handle.signal(donorResponseSignal, { donorId: "a", accepted: false });
    await handle.signal(donorResponseSignal, { donorId: "b", accepted: false });
    await waitFor(() => fake.calls.batches.length === 2);
    await handle.signal(donorResponseSignal, { donorId: "c", accepted: true });
  });
  assert.deepEqual(fake.calls.batches, [["a", "b"], ["c"]]);
  assert.equal(fake.calls.final, "FULFILLED");
  assert.ok(Date.now() - started < 30_000);
});

test("a reply from a donor never contacted does not count", async () => {
  const fake = fakeActivities({ 5: ["a"] });
  await run(fake, async (handle) => {
    await waitFor(() => fake.calls.batches.length === 1);
    await handle.signal(donorResponseSignal, { donorId: "intruder", accepted: true });
  });
  assert.equal(fake.calls.final, "EXHAUSTED");
});

async function waitFor(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(cond(), "condition not met in time");
}
