// Same vectors as the Rust unit tests in programs/holdfill_orders/src/math.rs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { haircutBps, requiredOutput } from "./math";

const NUM = 1n, DEN = 2n;

test("full entitlement at zero haircut", () => assert.equal(requiredOutput(1_000_000_000n, NUM, DEN, 0n), 500_000_000n));
test("twenty percent limit", () => assert.equal(requiredOutput(100_000_000n, NUM, DEN, 2_000n), 40_000_000n));
test("rounds up for the holder", () => {
  assert.equal(requiredOutput(3n, NUM, DEN, 2_000n), 2n);
  assert.equal(requiredOutput(1n, NUM, DEN, 0n), 1n);
});
test("single division is not below true value", () => assert.equal(requiredOutput(7n, NUM, DEN, 3_000n), 3n));
test("max u64 amount", () => assert.equal(requiredOutput(18446744073709551615n, NUM, DEN, 0n), 9223372036854775808n));
test("rejects bad inputs", () => {
  assert.throws(() => requiredOutput(1n, 1n, 0n, 0n));
  assert.throws(() => requiredOutput(1n, 1n, 1n, 10_001n));
});
test("fallback switches to floor", () => {
  assert.equal(haircutBps(99n, 100n, 2_000n, 5_000n), 2_000n);
  assert.equal(haircutBps(100n, 100n, 2_000n, 5_000n), 5_000n);
});
