// Meteora DLMM pairs for devnet replica markets: create at a given price, then seed liquidity with
// the quote token below the price and the base token above it.
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";
import DLMM, { StrategyType, deriveLbPairWithPresetParamWithIndexKey } from "@meteora-ag/dlmm";
import { DLMM_PROGRAM_ID } from "./env";

export const BIN_STEP = 10; // the only bin step with a devnet preset (checked 23 Sep 2026)

/** Creates the pair with `base` as token X at `pricePerLamport` (quote base units per base unit). */
export async function createPair(conn: Connection, issuer: Keypair, base: PublicKey, quote: PublicKey, pricePerLamport: number) {
  const presets = await DLMM.getAllPresetParameters(conn);
  const preset = presets.presetParameter2.find((p) => p.account.binStep === BIN_STEP);
  if (!preset) throw new Error(`no PresetParameter2 with bin step ${BIN_STEP} on devnet`);
  const activeId = DLMM.getBinIdFromPrice(pricePerLamport, BIN_STEP, true);
  const tx = await DLMM.createLbPair2(conn, issuer.publicKey, base, quote, preset.publicKey, new BN(activeId), { cluster: "devnet" });
  await sendAndConfirmTransaction(conn, tx, [issuer], { commitment: "confirmed" });
  const [pair] = deriveLbPairWithPresetParamWithIndexKey(preset.publicKey, base, quote, DLMM_PROGRAM_ID);
  const info = await conn.getAccountInfo(pair, "confirmed");
  if (!info?.owner.equals(DLMM_PROGRAM_ID)) throw new Error(`pair ${pair.toBase58()} not found after creation`);
  if (!new PublicKey(info.data.subarray(88, 120)).equals(base)) throw new Error("base is not token X in the new pair");
  return { pair, activeId };
}

/** One position of quote liquidity below the active bin and one of base liquidity from it upward. */
export async function seedLiquidity(conn: Connection, issuer: Keypair, pair: PublicKey, range: number, seedBase: bigint, seedQuote: bigint) {
  const active = (await DLMM.create(conn, pair, { cluster: "devnet" })).lbPair.activeId;
  const bins = Math.ceil(Math.log(1 / (1 - range)) / Math.log(1 + BIN_STEP / 10_000));
  const positions: string[] = [];
  for (const side of ["y", "x"] as const) {
    const r = side === "y" ? { min: active - bins, max: active - 1 } : { min: active, max: active + bins - 1 };
    const position = Keypair.generate();
    const pool = await DLMM.create(conn, pair, { cluster: "devnet" });
    const tx = await pool.initializePositionAndAddLiquidityByStrategy({
      positionPubKey: position.publicKey,
      totalXAmount: new BN(side === "x" ? seedBase.toString() : "0"),
      totalYAmount: new BN(side === "y" ? seedQuote.toString() : "0"),
      strategy: { minBinId: r.min, maxBinId: r.max, strategyType: StrategyType.Spot, ...(side === "x" ? { singleSidedX: true } : {}) },
      user: issuer.publicKey,
      slippage: 1,
    });
    await sendAndConfirmTransaction(conn, tx, [issuer, position], { commitment: "confirmed" });
    positions.push(position.publicKey.toBase58());
  }
  return positions;
}
