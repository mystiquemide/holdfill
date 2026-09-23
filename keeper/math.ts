// TypeScript copy of programs/holdfill_orders/src/math.rs. The keeper uses it to size fills; the
// program remains the authority. keeper/math.test.ts checks both give identical results.
export const BPS = 10_000n;

export function haircutBps(now: bigint, fallbackTs: bigint, limitBps: bigint, fallbackFloorBps: bigint): bigint {
  return now < fallbackTs ? limitBps : BPS - fallbackFloorBps;
}

/** ceil(amountIn * num * (BPS - haircut) / (den * BPS)), one division, rounded up for the holder. */
export function requiredOutput(amountIn: bigint, ratioNum: bigint, ratioDen: bigint, haircut: bigint): bigint {
  if (ratioDen === 0n || haircut > BPS) throw new Error("invalid terms");
  const numerator = amountIn * ratioNum * (BPS - haircut);
  const denominator = ratioDen * BPS;
  return (numerator + denominator - 1n) / denominator;
}
