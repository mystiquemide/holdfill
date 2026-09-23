import "server-only";
import BN from "bn.js";
import DLMM from "@meteora-ag/dlmm";
import { TOKEN_2022_PROGRAM_ID, getEpochFee, getMint, getTransferFeeConfig } from "@solana/spl-token";
import { cached } from "./cache";
import { MAINNET, SPACEX_TERMS, mainnet } from "./env";

const RAW = 1_000_000_000n;   // 1 raw SPACEX token (9 decimals) = 5 shares
const SPCXX_UNIT = 100_000_000; // 8 decimals

export type Sourced<T> = { value: T; source: string; asOf: string };

export type Market = {
  network: "mainnet";
  asOf: string;
  quote: Sourced<{ inRawTokens: number; inShares: number; outSpcxx: number; entitlementSpcxx: number; executableGapPct: number }>;
  midGapPct: Sourced<number>;
  poolFeePct: Sourced<number>;
  transferFeeBps: Sourced<number>;
  prestocksMarkUsd: Sourced<number>;
  entitlementUsdPerToken: Sourced<number>;
  marketUsdPerToken: Sourced<number>;
  spcxxUsd: Sourced<number>;
  holders: Sourced<number>;
  supplyShares: Sourced<number>;
  deadline: Sourced<{ at: string; daysLeft: number }>;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json() as Promise<T>;
}

async function loadMarket(): Promise<Market> {
  const conn = mainnet();
  const now = new Date();
  const asOf = now.toISOString();
  const sourced = <T>(value: T, source: string): Sourced<T> => ({ value, source, asOf });

  const [pool, mint, epoch, prestocks, prices, tokenInfo] = await Promise.all([
    DLMM.create(conn, MAINNET.pool),
    getMint(conn, MAINNET.spacex, "confirmed", TOKEN_2022_PROGRAM_ID),
    conn.getEpochInfo("confirmed"),
    json<Array<{ symbol: string; markPrice: number; supply: number }>>("https://prestocks.com/api/prestocks"),
    json<Record<string, { usdPrice: number }>>(`https://lite-api.jup.ag/price/v3?ids=${MAINNET.spcxx.toBase58()}`),
    json<Array<{ id: string; holderCount: number }>>(`https://lite-api.jup.ag/tokens/v2/search?query=${MAINNET.spacex.toBase58()}`),
  ]);

  // Executable quote for one raw token: includes the pool fee, the 1% transfer fee, and slippage.
  const bins = await pool.getBinArrayForSwap(true, 8);
  const q = pool.swapQuote(new BN(RAW.toString()), true, new BN(0), bins);
  const outSpcxx = Number(q.outAmount.toString()) / SPCXX_UNIT;
  const entitlementSpcxx = SPACEX_TERMS.sharesPerToken;
  const executableGapPct = (1 - outSpcxx / entitlementSpcxx) * 100;

  const active = await pool.getActiveBin();
  const midSpcxxPerToken = Number(active.price) * (Number(RAW) / SPCXX_UNIT);
  const midGapPct = (1 - midSpcxxPerToken / entitlementSpcxx) * 100;

  const feeConfig = getTransferFeeConfig(mint);
  const transferFeeBps = feeConfig ? Number(getEpochFee(feeConfig, BigInt(epoch.epoch)).transferFeeBasisPoints) : 0;
  const spacex = prestocks.find((p) => p.symbol === "SPACEX");
  if (!spacex) throw new Error("SPACEX missing from the PreStocks API");
  const spcxxUsd = prices[MAINNET.spcxx.toBase58()]?.usdPrice;
  if (!spcxxUsd) throw new Error("SPCXx price missing from Jupiter");
  const holders = tokenInfo.find((t) => t.id === MAINNET.spacex.toBase58())?.holderCount ?? 0;
  const daysLeft = Math.max(0, Math.ceil((Date.parse(SPACEX_TERMS.deadline) - now.getTime()) / 86_400_000));

  return {
    network: "mainnet",
    asOf,
    quote: sourced({ inRawTokens: 1, inShares: SPACEX_TERMS.sharesPerToken, outSpcxx, entitlementSpcxx, executableGapPct },
      `Meteora DLMM ${MAINNET.pool.toBase58()} swap quote, fees included`),
    midGapPct: sourced(midGapPct, "Meteora DLMM active bin price"),
    poolFeePct: sourced(Number(pool.getFeeInfo().baseFeeRatePercentage.toString()), "Meteora DLMM pool fee"),
    transferFeeBps: sourced(transferFeeBps, "SPACEX mint TransferFeeConfig, current epoch"),
    prestocksMarkUsd: sourced(spacex.markPrice, "PreStocks API markPrice"),
    entitlementUsdPerToken: sourced(spacex.markPrice * SPACEX_TERMS.sharesPerToken, "5 x PreStocks markPrice"),
    marketUsdPerToken: sourced(outSpcxx * spcxxUsd, "pool quote x Jupiter SPCXx price"),
    spcxxUsd: sourced(spcxxUsd, "Jupiter price API"),
    holders: sourced(holders, "Jupiter tokens API holderCount"),
    supplyShares: sourced(spacex.supply, "PreStocks API supply (shares, split-adjusted)"),
    deadline: sourced({ at: SPACEX_TERMS.deadline, daysLeft }, SPACEX_TERMS.deadlineSource),
  };
}

export const getMarket = () => cached("market", 15_000, loadMarket);
