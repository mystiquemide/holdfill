import "server-only";
import BN from "bn.js";
import DLMM from "@meteora-ag/dlmm";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createApproveCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { BN as AnchorBN } from "@anchor-lang/core";
import { loadProgram, orderKind, orders } from "../../../keeper/program";
import { cached } from "./cache";
import { DEVNET, DEVNET_USDC, USDC_MARKETS, devnet, mainnet } from "./env";
import { TxInputError, unsigned } from "./tx";

export type UsdcMarket = (typeof USDC_MARKETS)[string];

export function usdcMarket(symbol: string | null | undefined): UsdcMarket {
  const m = symbol ? USDC_MARKETS[symbol.toUpperCase()] : undefined;
  if (!m) throw new TxInputError(`Unknown market. Pick one of ${Object.keys(USDC_MARKETS).join(", ")}.`);
  return m;
}

export const orderAddressFor = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("order"), owner.toBuffer(), mint.toBuffer()], DEVNET.programId)[0];
const eventAddressFor = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("event"), mint.toBuffer()], DEVNET.programId)[0];
const ata2022 = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
const usdcAta = (owner: PublicKey) => getAssociatedTokenAddressSync(DEVNET_USDC, owner, false, TOKEN_PROGRAM_ID);

export type MarketQuote = { inTokens: 1; outUsdc: number; asOf: string; source: string };

/** Executable devnet quote for selling one whole replica token into replica USDC, fees included. */
export const getMarketQuote = (m: UsdcMarket) => cached(`mquote:${m.symbol}`, 15_000, async (): Promise<MarketQuote> => {
  const pool = await DLMM.create(devnet(), m.pool, { cluster: "devnet" as never });
  const bins = await pool.getBinArrayForSwap(true, 8);
  const q = pool.swapQuote(new BN(1_000_000_000), true, new BN(0), bins);
  return {
    inTokens: 1, outUsdc: Number(q.outAmount.toString()) / 1e6, asOf: new Date().toISOString(),
    source: `Meteora DLMM ${m.pool.toBase58()} (devnet) swap quote, pool and transfer fees included`,
  };
});

async function tokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey, programId: PublicKey) {
  const res = await conn.getParsedTokenAccountsByOwner(owner, { mint, programId }, "confirmed");
  let raw = 0n, delegatedRaw = 0n;
  let delegate: string | null = null;
  for (const { account } of res.value) {
    const info = account.data.parsed.info;
    raw += BigInt(info.tokenAmount.amount);
    if (info.delegate) { delegate = info.delegate; delegatedRaw += BigInt(info.delegatedAmount?.amount ?? "0"); }
  }
  return { raw, delegate, delegatedRaw };
}

export type MarketOrder = {
  address: string;
  kind: "price" | "armed" | "convert";
  status: "active" | "filled" | "armed";
  sizeRaw: string; filledRaw: string; receivedRaw: string;
  approvalInPlace: boolean;
  /** Price orders: least USDC per whole token. */
  minUsdcPerToken: number | null;
  expiresAt: string | null;
  /** Armed orders: terms relative to the entitlement the issuer will name. */
  limitBps: number; fallbackDaysBefore: number | null; fallbackFloorBps: number;
  outputMint: string;
};

export type MarketPosition = {
  owner: string; symbol: string; name: string; asOf: string;
  mainnet: { network: "mainnet"; tokens: number };
  devnet: { network: "devnet"; sol: number; tokens: number; tokensRaw: string; usdc: number; quote: MarketQuote | null; order: MarketOrder | null };
};

async function loadMarketPosition(owner: PublicKey, m: UsdcMarket): Promise<MarketPosition> {
  const conn = devnet();
  const program = loadProgram(conn, Keypair.generate());
  const pda = orderAddressFor(owner, m.mint);
  const [mainBal, tok, usdc, sol, order, quote] = await Promise.all([
    tokenBalance(mainnet(), owner, m.mainnetMint, TOKEN_2022_PROGRAM_ID),
    tokenBalance(conn, owner, m.mint, TOKEN_2022_PROGRAM_ID),
    tokenBalance(conn, owner, DEVNET_USDC, TOKEN_PROGRAM_ID),
    conn.getBalance(owner, "confirmed"),
    orders(program).fetchNullable(pda),
    getMarketQuote(m).catch(() => null),
  ]);
  let view: MarketOrder | null = null;
  if (order) {
    const kind = orderKind(order);
    view = {
      address: pda.toBase58(), kind,
      status: kind === "armed" ? "armed" : "filled" in order.status ? "filled" : "active",
      sizeRaw: order.size.toString(), filledRaw: order.filled.toString(), receivedRaw: order.received.toString(),
      approvalInPlace: tok.delegate === pda.toBase58() && tok.delegatedRaw > 0n,
      minUsdcPerToken: kind === "price" ? Number(order.ratioNum.toString()) / 1e6 : null,
      expiresAt: kind === "armed" ? null : new Date(Number(order.expiryTs.toString()) * 1000).toISOString(),
      limitBps: order.limitBps,
      fallbackDaysBefore: kind === "armed" ? Number(order.fallbackTs.toString()) / 86_400 : null,
      fallbackFloorBps: order.fallbackFloorBps,
      outputMint: order.outputMint.toBase58(),
    };
  }
  return {
    owner: owner.toBase58(), symbol: m.symbol, name: m.name, asOf: new Date().toISOString(),
    mainnet: { network: "mainnet", tokens: Number(mainBal.raw) / 1e9 },
    devnet: { network: "devnet", sol: sol / LAMPORTS_PER_SOL, tokens: Number(tok.raw) / 1e9, tokensRaw: tok.raw.toString(), usdc: Number(usdc.raw) / 1e6, quote, order: view },
  };
}

export const getMarketPosition = (owner: PublicKey, m: UsdcMarket) =>
  cached(`mposition:${m.symbol}:${owner.toBase58()}`, 5_000, () => loadMarketPosition(owner, m));

const EXPIRY_DAYS = [30, 90, 180, 365] as const;
export const FALLBACK_DAYS = [7, 14, 30, 60, 90] as const;

async function preflight(owner: PublicKey, m: UsdcMarket, sizeRaw: bigint) {
  const conn = devnet();
  const program = loadProgram(conn, Keypair.generate());
  const order = orderAddressFor(owner, m.mint);
  const [existing, balance] = await Promise.all([
    orders(program).fetchNullable(order),
    conn.getTokenAccountBalance(ata2022(owner, m.mint), "confirmed").then((b) => BigInt(b.value.amount), () => 0n),
  ]);
  if (existing) throw new TxInputError("You already have an order for this token. Revoke it before setting a new one.");
  if (sizeRaw <= 0n) throw new TxInputError("Enter an amount above zero.");
  if (sizeRaw > balance) throw new TxInputError(`That is more replica ${m.symbol} than you hold.`);
  return { program, order };
}

/** Standing limit sell into USDC at the holder's price, plus the capped approval, in one transaction. */
export async function buildPriceOrder(p: { owner: PublicKey; symbol: string; sizeRaw: bigint; usdPerToken: number; expiryDays: number }) {
  const m = usdcMarket(p.symbol);
  if (!(p.usdPerToken > 0 && p.usdPerToken < 1_000_000)) throw new TxInputError("Enter a price above zero.");
  if (!EXPIRY_DAYS.includes(p.expiryDays as (typeof EXPIRY_DAYS)[number])) throw new TxInputError("Pick an expiry of 30, 90, 180, or 365 days.");
  const { program, order } = await preflight(p.owner, m, p.sizeRaw);
  const create = await program.methods
    .createPriceOrder({
      size: new AnchorBN(p.sizeRaw.toString()),
      minOutPerToken: new AnchorBN(Math.round(p.usdPerToken * 1e6)),
      expiryTs: new AnchorBN(Math.floor(Date.now() / 1000) + p.expiryDays * 86_400),
    })
    .accountsStrict({
      owner: p.owner, inputMint: m.mint, outputMint: DEVNET_USDC, pool: m.pool, event: eventAddressFor(m.mint),
      ownerTokenIn: ata2022(p.owner, m.mint), order, systemProgram: SystemProgram.programId,
    })
    .instruction();
  const tx = await unsigned(p.owner, [
    createAssociatedTokenAccountIdempotentInstruction(p.owner, usdcAta(p.owner), p.owner, DEVNET_USDC, TOKEN_PROGRAM_ID),
    create,
    createApproveCheckedInstruction(ata2022(p.owner, m.mint), m.mint, order, p.owner, p.sizeRaw, 9, [], TOKEN_2022_PROGRAM_ID),
  ]);
  return { tx, order: order.toBase58() };
}

/** Arms an order for the successor the issuer has not named yet, plus the capped approval. */
export async function buildArmOrder(p: { owner: PublicKey; symbol: string; sizeRaw: bigint; limitBps: number; fallbackDaysBefore: number; floorBps: number }) {
  const m = usdcMarket(p.symbol);
  if (!Number.isInteger(p.limitBps) || p.limitBps < 0 || p.limitBps > 6000) throw new TxInputError("The largest gap you can accept is 60%.");
  if (![4000, 5000, 6000, 7000].includes(p.floorBps)) throw new TxInputError("Pick a fallback floor of 40, 50, 60, or 70%.");
  if (!FALLBACK_DAYS.includes(p.fallbackDaysBefore as (typeof FALLBACK_DAYS)[number])) throw new TxInputError("Pick a fallback of 7, 14, 30, 60, or 90 days before the deadline.");
  const { program, order } = await preflight(p.owner, m, p.sizeRaw);
  const arm = await program.methods
    .armOrder({ size: new AnchorBN(p.sizeRaw.toString()), limitBps: p.limitBps, fallbackDaysBefore: p.fallbackDaysBefore, fallbackFloorBps: p.floorBps })
    .accountsStrict({ owner: p.owner, inputMint: m.mint, event: eventAddressFor(m.mint), ownerTokenIn: ata2022(p.owner, m.mint), order, systemProgram: SystemProgram.programId })
    .instruction();
  const tx = await unsigned(p.owner, [
    arm,
    createApproveCheckedInstruction(ata2022(p.owner, m.mint), m.mint, order, p.owner, p.sizeRaw, 9, [], TOKEN_2022_PROGRAM_ID),
  ]);
  return { tx, order: order.toBase58() };
}
