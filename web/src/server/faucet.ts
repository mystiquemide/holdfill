import "server-only";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { DEVNET, DEVNET_USDC, devnet, keypairFromEnv } from "./env";
import { orderAddress } from "./orders";
import type { UsdcMarket } from "./usdc-markets";

const GRANT_RAW = 1_000_000_000n;            // 1 raw replica token (1 SPACEX = 5 shares)
const HOLDING_CAP_RAW = 500_000_000n;        // refuse wallets already holding 0.5 raw or more
const SOL_TOPUP = 0.02 * LAMPORTS_PER_SOL;   // covers order rent and fees
const SOL_TOPUP_BELOW = 0.005 * LAMPORTS_PER_SOL;
const WALLET_COOLDOWN_MS = 60 * 60 * 1000;
const GLOBAL_LIMIT_PER_HOUR = 20;
// The issuer key also pays ATA rent for every grant. Keep a reserve so fresh wallets can't drain it.
const SOL_TOPUPS_PER_HOUR = 6;
const ISSUER_RESERVE_FOR_TOPUPS = 0.5 * LAMPORTS_PER_SOL;
const ISSUER_RESERVE_FOR_GRANTS = 0.2 * LAMPORTS_PER_SOL;
const HOUR = 60 * 60 * 1000;
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

const lastGrant = new Map<string, number>();
const recentGrants: number[] = [];
const recentTopups: number[] = [];

export type FaucetResult =
  | { ok: true; network: "devnet"; symbol: string; signature: string; sentRaw: string; sentShares: number; sentSol: number; explorer: string }
  | { ok: false; status: 429 | 503; error: string; retryAt?: string };

/** Sends 1 raw replica token: SPACEX by default, or a USDC market's token with a USDC account to sell into. */
export async function grant(owner: PublicKey, market?: UsdcMarket): Promise<FaucetResult> {
  const now = Date.now();
  const symbol = market?.symbol ?? "SPACEX";
  const mint = market?.mint ?? DEVNET.spacex;
  const key = `${symbol}:${owner.toBase58()}`;
  while (recentGrants.length && now - recentGrants[0] > HOUR) recentGrants.shift();
  while (recentTopups.length && now - recentTopups[0] > HOUR) recentTopups.shift();
  if (recentGrants.length >= GLOBAL_LIMIT_PER_HOUR) {
    return { ok: false, status: 429, error: `The faucet hit its hourly limit. It reopens at ${hhmm(recentGrants[0] + HOUR)} UTC.`, retryAt: new Date(recentGrants[0] + 60 * 60 * 1000).toISOString() };
  }

  const conn = devnet();
  const tokenAta = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
  const [balance, lamports, order] = await Promise.all([
    conn.getTokenAccountBalance(tokenAta, "confirmed").then((b) => BigInt(b.value.amount)).catch(() => 0n),
    conn.getBalance(owner, "confirmed"),
    conn.getAccountInfo(orderAddress(owner, mint), "confirmed"),
  ]);
  // Survives restarts: the chain itself says whether this wallet already has enough.
  if (balance >= HOLDING_CAP_RAW) {
    return { ok: false, status: 429, error: `You already have ${Number(balance) / 1e9} replica ${symbol}, enough to set an order.` };
  }
  if (!process.env.ISSUER_KEYPAIR) {
    return { ok: false, status: 503, error: "This copy of Holdfill has no faucet key. Get replica tokens from the faucet at holdfill.vercel.app, then set orders here." };
  }
  const issuer = keypairFromEnv("ISSUER_KEYPAIR");
  const issuerLamports = await conn.getBalance(issuer.publicKey, "confirmed");
  if (issuerLamports < ISSUER_RESERVE_FOR_GRANTS) {
    return { ok: false, status: 503, error: "The devnet faucet is out of SOL for now. Try the recorded demo, or come back later." };
  }

  // Every shared cap is checked again here, after the awaits, and its slot is taken synchronously,
  // so concurrent requests can't all pass the same check. A failed send gives the slots back.
  const at = Date.now();
  while (recentGrants.length && at - recentGrants[0] > HOUR) recentGrants.shift();
  while (recentTopups.length && at - recentTopups[0] > HOUR) recentTopups.shift();
  if (recentGrants.length >= GLOBAL_LIMIT_PER_HOUR) {
    return { ok: false, status: 429, error: `The faucet hit its hourly limit. It reopens at ${hhmm(recentGrants[0] + HOUR)} UTC.`, retryAt: new Date(recentGrants[0] + HOUR).toISOString() };
  }
  // A wallet whose last order sold everything can refill right away; the hourly limit covers the rest.
  const last = lastGrant.get(key);
  if (!(balance === 0n && !order) && last && at - last < WALLET_COOLDOWN_MS) {
    return { ok: false, status: 429, error: "One faucet request per wallet per hour.", retryAt: new Date(last + WALLET_COOLDOWN_MS).toISOString() };
  }
  const needsSol = lamports < SOL_TOPUP_BELOW;
  if (needsSol && !(issuerLamports >= ISSUER_RESERVE_FOR_TOPUPS && recentTopups.length < SOL_TOPUPS_PER_HOUR)) {
    const reopens = recentTopups.length ? recentTopups[0] + HOUR : at + HOUR;
    return { ok: false, status: 429, error: `Your wallet needs a little devnet SOL for fees, and the faucet's SOL allowance is used up until ${hhmm(reopens)} UTC. Get devnet SOL at faucet.solana.com, then try again.`, retryAt: new Date(reopens).toISOString() };
  }
  const sol = needsSol ? SOL_TOPUP : 0;
  recentGrants.push(at);
  if (sol > 0) recentTopups.push(at);
  lastGrant.set(key, at);
  const release = () => {
    recentGrants.splice(recentGrants.indexOf(at), 1);
    if (sol > 0) recentTopups.splice(recentTopups.indexOf(at), 1);
    if (last === undefined) lastGrant.delete(key); else lastGrant.set(key, last);
  };
  // The account the order sells into: SPCXx for SPACEX, replica USDC (classic SPL Token) otherwise.
  const out = market
    ? createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, getAssociatedTokenAddressSync(DEVNET_USDC, owner, false, TOKEN_PROGRAM_ID), owner, DEVNET_USDC, TOKEN_PROGRAM_ID)
    : createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, getAssociatedTokenAddressSync(DEVNET.spcxx, owner, false, TOKEN_2022_PROGRAM_ID), owner, DEVNET.spcxx, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, tokenAta, owner, mint, TOKEN_2022_PROGRAM_ID),
    out,
    createMintToCheckedInstruction(mint, tokenAta, issuer.publicKey, GRANT_RAW, 9, [], TOKEN_2022_PROGRAM_ID),
  );
  if (sol > 0) tx.add(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: owner, lamports: sol }));

  try {
    const signature = await sendAndConfirmTransaction(conn, tx, [issuer], { commitment: "confirmed" });
    return {
      ok: true, network: "devnet", symbol, signature, sentRaw: GRANT_RAW.toString(), sentShares: market ? 1 : 5,
      sentSol: sol / LAMPORTS_PER_SOL, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    };
  } catch (e) {
    release();
    console.error("faucet send failed", String((e as Error).message).slice(0, 300));
    return { ok: false, status: 503, error: "The faucet couldn't send tokens just now. Nothing was sent. Try again in a minute." };
  }
}
