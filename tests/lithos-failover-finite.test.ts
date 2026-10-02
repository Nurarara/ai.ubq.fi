import assert from "node:assert/strict";
import { clearLithosFailoverWindows, lithosFailoverTargetAt, lithosOpenFailoverWindow, lithosRateLimitWait } from "../src/provider/lithos-rate-limits.ts";

const model = "deepseek-ai/DeepSeek-V4.1-Flash-ultra";
const target = "deepseek-ai/DeepSeek-V4.1-Flash-fast";

Deno.test("Lithos rejects overflowing retry-after-ms rather than opening an immortal window", () => {
  clearLithosFailoverWindows();
  const wait = lithosRateLimitWait(new Headers({ "retry-after-ms": "9".repeat(310) }), 1_000);
  if (wait !== null) lithosOpenFailoverWindow(model, 1_000, wait.waitMs, target);
  assert.equal(lithosFailoverTargetAt(model, 100_000), null);
  assert.equal(wait, null);
});

Deno.test("Lithos ignores overflowing millisecond hints but preserves a valid vendor reset", () => {
  const wait = lithosRateLimitWait(new Headers({ "retry-after-ms": "9".repeat(310), "x-ratelimit-reset-tokens": "90s" }), 1_000);
  assert.ok(wait);
  assert.deepEqual(wait, { waitMs: 90_000, source: "x-ratelimit-reset-tokens" });
  clearLithosFailoverWindows();
  lithosOpenFailoverWindow(model, 1_000, wait.waitMs, target);
  assert.equal(lithosFailoverTargetAt(model, 90_999), target);
  assert.equal(lithosFailoverTargetAt(model, 91_000), null);
});

Deno.test("Lithos rejects retry-after seconds that overflow during conversion to milliseconds", () => {
  assert.equal(lithosRateLimitWait(new Headers({ "retry-after": "9".repeat(307) }), 1_000), null);
});

Deno.test("Lithos cannot store a non-finite delay or calculated deadline", () => {
  for (const [nowMs, waitMs] of [
    [1_000, Infinity],
    [1_000, -Infinity],
    [1_000, NaN],
    [Infinity, 1_000],
    [NaN, 1_000],
    [Number.MAX_VALUE, Number.MAX_VALUE],
  ]) {
    clearLithosFailoverWindows();
    lithosOpenFailoverWindow(model, nowMs, waitMs, target);
    assert.equal(lithosFailoverTargetAt(model, 100_000), null);
  }
});

Deno.test("Lithos ignores an invalid update without corrupting an existing finite window", () => {
  clearLithosFailoverWindows();
  lithosOpenFailoverWindow(model, 1_000, 90_000, target);
  lithosOpenFailoverWindow(model, 2_000, Infinity, target);
  assert.equal(lithosFailoverTargetAt(model, 90_999), target);
  assert.equal(lithosFailoverTargetAt(model, 91_000), null);
});

Deno.test("Lithos preserves valid zero and millisecond delays and retry refusal precedence", () => {
  assert.deepEqual(lithosRateLimitWait(new Headers({ "retry-after-ms": "0" }), 1_000), { waitMs: 0, source: "retry-after-ms" });
  assert.deepEqual(lithosRateLimitWait(new Headers({ "retry-after-ms": "250", "retry-after": "9" }), 1_000), {
    waitMs: 250,
    source: "retry-after-ms",
  });
  assert.equal(lithosRateLimitWait(new Headers({ "retry-after-ms": "250", "x-should-retry": "false" }), 1_000), null);
});
