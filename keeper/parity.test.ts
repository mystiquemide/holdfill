// Replays vectors written by the program's Rust tests (programs/holdfill_orders/tests/math_props.rs)
// against the keeper's TypeScript math. Run `npm run test:parity`, which generates them first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { haircutBps, requiredOutput } from "./math";

const U64_MAX = (1n << 64n) - 1n;
const lines = readFileSync(join(__dirname, "../target/parity/math-vectors.txt"), "utf8").trim().split("\n");

test(`keeper math matches the program on ${lines.length} Rust vectors`, () => {
  let mins = 0, schedules = 0;
  for (const line of lines) {
    const f = line.split(" ");
    if (f[0] === "h") {
      const [now, fb, limit, floor, want] = f.slice(1).map(BigInt);
      assert.equal(haircutBps(now, fb, limit, floor), want, line);
      schedules++;
      continue;
    }
    const [amount, num, den, haircut] = f.slice(0, 4).map(BigInt);
    let got: string;
    try {
      const r = requiredOutput(amount, num, den, haircut);
      got = r > U64_MAX ? "none" : r.toString(); // the program refuses a minimum that overflows u64
    } catch {
      got = "none";
    }
    assert.equal(got, f[4], line);
    mins++;
  }
  assert.ok(mins >= 1000 && schedules >= 1000, "too few vectors");
});
