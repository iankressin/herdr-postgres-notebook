import { test } from "node:test";
import assert from "node:assert/strict";
import { ViewWorker } from "../../src/runtime/view-worker.js";

test("jobs use the owning view context, including jobs queued by another task", async () => {
  let loop;
  const owner = { label: "owner" };
  const worker = new ViewWorker({ spawn: (work) => { loop = work(owner); } });
  const seen = [];
  let finished;
  const done = new Promise((resolve) => { finished = resolve; });
  worker.spawn(async (cx) => {
    seen.push(cx);
    await Promise.resolve();
    worker.spawn((cx) => { seen.push(cx); finished(); });
  });
  await done;
  worker.close();
  await loop;
  assert.deepEqual(seen, [owner, owner]);
});

test("a failed job does not stop later jobs", async () => {
  let loop;
  let reported;
  const failure = new Promise((resolve) => { reported = resolve; });
  const worker = new ViewWorker({ spawn: (work) => { loop = work({}); } }, reported);
  worker.spawn(() => { throw new Error("failed job"); });
  const error = await failure;
  let ran;
  const done = new Promise((resolve) => { ran = resolve; });
  worker.spawn(ran);
  await done;
  worker.close();
  await loop;
  assert.equal(error.message, "failed job");
});

test("closing an idle worker ends its loop and refuses new work", async () => {
  let loop;
  const worker = new ViewWorker({ spawn: (work) => { loop = work({}); } });
  worker.close();
  worker.spawn(() => assert.fail("a closed view ran a job"));
  await loop;
});
