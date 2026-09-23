// Property tests for the keeper's math and fill sizing. 10,000 random cases per property.
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { BPS, requiredOutput } from "./math";
import { bestFill } from "./tick";

const runs = Number(process.env.PROPTEST_CASES ?? 10_000);
const u64 = fc.oneof(fc.bigInt({ min: 0n, max: 1_000n }), fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }));
const ratio = fc.oneof(fc.bigInt({ min: 1n, max: 100n }), fc.bigInt({ min: 1n, max: 1_000_000_000_000n }));
const haircut = fc.bigInt({ min: 0n, max: BPS });

test("minimum is the exact ceiling of the target", () => {
  fc.assert(fc.property(u64, ratio, ratio, haircut, (a, num, den, h) => {
    const r = requiredOutput(a, num, den, h);
    const n = a * num * (BPS - h), d = den * BPS;
    return r * d >= n && (r === 0n || (r - 1n) * d < n);
  }), { numRuns: runs });
});

// A pool whose payout per unit falls as size grows (price impact), sometimes with a hard liquidity cap.
const pool = fc.record({
  num: fc.bigInt({ min: 1n, max: 1_000_000n }),
  den: fc.bigInt({ min: 1n, max: 1_000_000n }),
  impact: fc.bigInt({ min: 0n, max: 1_000_000_000n }),
  cap: fc.option(fc.bigInt({ min: 1n, max: 1n << 40n }), { nil: undefined }),
});
const quoteFor = (p: { num: bigint; den: bigint; impact: bigint; cap?: bigint }) => (a: bigint) =>
  p.cap !== undefined && a > p.cap ? 0n : (a * p.num) / p.den - (a * a) / (p.impact + 1n) / 1_000_000n;

const fillCase = fc.record({
  pool, remaining: fc.bigInt({ min: 1n, max: 1n << 40n }), minChunk: fc.bigInt({ min: 1n, max: 1n << 30n }),
  num: ratio, den: ratio, h: haircut,
});

test("a chosen fill always meets the holder's minimum and stays in range", () => {
  fc.assert(fc.property(fillCase, (c) => {
    const quote = quoteFor(c.pool);
    const req = (a: bigint) => requiredOutput(a, c.num, c.den, c.h);
    const best = bestFill(quote, req, c.remaining, c.minChunk);
    if (!best) return true;
    return best.amount <= c.remaining && best.out === quote(best.amount) && best.out >= req(best.amount)
      && (best.amount === c.remaining || best.amount >= c.minChunk);
  }), { numRuns: runs });
});

test("the keeper only waits when no size from minChunk up would pass", () => {
  fc.assert(fc.property(fillCase, (c) => {
    const quote = quoteFor(c.pool);
    const req = (a: bigint) => requiredOutput(a, c.num, c.den, c.h);
    if (bestFill(quote, req, c.remaining, c.minChunk)) return true;
    const ok = (a: bigint) => quote(a) >= req(a);
    return !ok(c.remaining) && (c.minChunk > c.remaining || !ok(c.minChunk));
  }), { numRuns: runs });
});

test("the fill is the largest passing size, within the search resolution", () => {
  fc.assert(fc.property(fillCase, (c) => {
    const quote = quoteFor(c.pool);
    const req = (a: bigint) => requiredOutput(a, c.num, c.den, c.h);
    const best = bestFill(quote, req, c.remaining, c.minChunk);
    if (!best || best.amount === c.remaining) return true;
    // 24 halvings: the next size up fails whenever the range fits in 2^24 steps, and in general the
    // chosen size is within (remaining - minChunk) / 2^24 of the largest passing size.
    const step = (c.remaining - c.minChunk) / (1n << 24n) + 1n;
    const ok = (a: bigint) => quote(a) >= req(a);
    return !ok(best.amount + step) || best.amount + step > c.remaining;
  }), { numRuns: runs });
});
