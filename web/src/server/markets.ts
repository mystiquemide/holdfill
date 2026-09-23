import "server-only";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, getEpochFee, getPausableConfig, getPermanentDelegate, getTransferFeeConfig, unpackMint,
} from "@solana/spl-token";
import caseStudy from "../../../data/case-study.json";
import { cached } from "./cache";
import { mainnet } from "./env";
import { createOrder } from "./jupiter-check";

/** Issuer-announced lifecycle events, quoted from each PreStocks page. Tokens without one are "none". */
const EVENTS: Record<string, { successor: string; terms: string; deadline: string; source: string }> = {
  SPACEX: {
    successor: "SpaceX xStock (SPCXx)",
    terms: "SpaceX PreStocks tokens must be swapped into $SPCXx or any other token before 11:59pm UTC on 12 March 2027, or they will expire worthless.",
    deadline: "2027-03-12T23:59:00Z",
    source: "https://prestocks.com/spacex",
  },
};

export type MarketRow = {
  symbol: string;
  name: string;
  mint: string;
  markUsd: number;
  supply: number;
  markValueUsd: number;
  holders: number | null;
  poolUsd: number | null;
  vsMarkPct: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  transferFeeBps: number | null;
  paused: boolean | null;
  permanentDelegate: boolean | null;
  jupiterTrigger: { refused: boolean; httpStatus: number; message: string } | null;
  event: { successor: string; terms: string; deadline: string; daysLeft: number; source: string } | null;
};

export type ExpiredMarket = { symbol: string; mint: string; terms: string; deadline: string; source: string; walletsHolding: number; tokensHeld: number; checkedAt: string };

export type Markets = {
  network: "mainnet";
  asOf: string;
  markets: MarketRow[];
  expired: ExpiredMarket[];
  sources: Record<string, string>;
};

type PreStock = { symbol: string; name: string; contract_address: string; markPrice: number; supply: number };
type JupToken = {
  id: string; holderCount?: number; usdPrice?: number; liquidity?: number;
  stats24h?: { buyVolume?: number; sellVolume?: number };
};

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json() as Promise<T>;
}

/** Jupiter's refusal is stable, so each mint is checked at most every 10 minutes. */
const triggerCheck = (mint: string) => cached(`trigger:${mint}`, 600_000, async () => {
  const r = await createOrder(mint, "100000000");
  const body = r.body as { error?: string } | null;
  return { refused: !r.accepted, httpStatus: r.httpStatus, message: (body?.error ?? "").replace(/^unable to validate create order request: /, "") };
});

async function load(): Promise<Markets> {
  const conn = mainnet();
  const now = Date.now();
  const prestocks = await json<PreStock[]>("https://prestocks.com/api/prestocks");
  const mints = prestocks.map((p) => p.contract_address);

  const [tokens, accounts, epoch, triggers] = await Promise.all([
    json<JupToken[]>(`https://lite-api.jup.ag/tokens/v2/search?query=${mints.join(",")}`).catch(() => [] as JupToken[]),
    conn.getMultipleAccountsInfo(mints.map((m) => new PublicKey(m)), "confirmed"),
    conn.getEpochInfo("confirmed"),
    Promise.all(mints.map((m) => triggerCheck(m).catch(() => null))),
  ]);

  const markets = prestocks.map((p, i): MarketRow => {
    const t = tokens.find((x) => x.id === p.contract_address);
    const info = accounts[i];
    const mint = info ? unpackMint(new PublicKey(p.contract_address), info, TOKEN_2022_PROGRAM_ID) : null;
    const fee = mint && getTransferFeeConfig(mint);
    const ev = EVENTS[p.symbol];
    return {
      symbol: p.symbol,
      name: p.name.replace(/ PreStocks$/, ""),
      mint: p.contract_address,
      markUsd: p.markPrice,
      supply: p.supply,
      markValueUsd: p.markPrice * p.supply,
      holders: t?.holderCount ?? null,
      poolUsd: t?.usdPrice ?? null,
      vsMarkPct: t?.usdPrice ? (t.usdPrice / p.markPrice - 1) * 100 : null,
      liquidityUsd: t?.liquidity ?? null,
      volume24hUsd: t?.stats24h ? (t.stats24h.buyVolume ?? 0) + (t.stats24h.sellVolume ?? 0) : null,
      transferFeeBps: fee ? Number(getEpochFee(fee, BigInt(epoch.epoch)).transferFeeBasisPoints) : null,
      paused: mint ? !!getPausableConfig(mint)?.paused : null,
      permanentDelegate: mint ? !!getPermanentDelegate(mint) : null,
      jupiterTrigger: triggers[i],
      event: ev ? { ...ev, daysLeft: Math.max(0, Math.ceil((Date.parse(ev.deadline) - now) / 86_400_000)) } : null,
    };
  }).sort((a, b) => b.markValueUsd - a.markValueUsd);

  const xai = caseStudy.xai;
  return {
    network: "mainnet",
    asOf: new Date(now).toISOString(),
    markets,
    expired: [{
      symbol: "XAI",
      mint: xai.mint,
      terms: xai.issuerTerms.text,
      deadline: xai.issuerTerms.deadline,
      source: xai.issuerTerms.source,
      walletsHolding: xai.walletsHolding,
      tokensHeld: xai.xaiHeld,
      checkedAt: xai.checkedAt,
    }],
    sources: {
      mark: "PreStocks API markPrice and supply",
      holders: "Jupiter tokens API holderCount",
      price: "Jupiter tokens API usdPrice, liquidity, 24h buy plus sell volume",
      mint: "Mint account on chain: TransferFeeConfig (current epoch), PausableConfig, PermanentDelegate",
      trigger: "Jupiter Trigger V1 createOrder into USDC, checked every 10 minutes, nothing signed",
    },
  };
}

export const getMarkets = () => cached("markets", 60_000, load);
