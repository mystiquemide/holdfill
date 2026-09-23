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
    return { ok: false, status: 429, error: "The faucet is busy. Try again later.", retryAt: new Date(recentGrants[0] + 60 * 60 * 1000).toISOString() };
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
    return { ok: false, status: 429, error: `This wallet already holds ${Number(balance) / 1e9} replica ${symbol}. The faucet only tops up empty wallets.` };
  }
  // A wallet whose last order sold everything can refill right away; the hourly limit covers the rest.
  const last = lastGrant.get(key);
  const emptyAndIdle = balance === 0n && !order;
  if (!emptyAndIdle && last && now - last < WALLET_COOLDOWN_MS) {
    return { ok: false, status: 429, error: "One faucet request per wallet per hour.", retryAt: new Date(last + WALLET_COOLDOWN_MS).toISOString() };
  }

  const issuer = keypairFromEnv("ISSUER_KEYPAIR");
  const issuerLamports = await conn.getBalance(issuer.publicKey, "confirmed");
  if (issuerLamports < ISSUER_RESERVE_FOR_GRANTS) {
    return { ok: false, status: 503, error: "The devnet faucet is out of SOL for now. Try the recorded demo, or come back later." };
  }
  const topupAllowed = issuerLamports >= ISSUER_RESERVE_FOR_TOPUPS && recentTopups.length < SOL_TOPUPS_PER_HOUR;
  if (lamports < SOL_TOPUP_BELOW && !topupAllowed) {
    return { ok: false, status: 429, error: "Your wallet needs a little devnet SOL for fees, and the faucet's SOL allowance is used up for this hour. Get devnet SOL at faucet.solana.com, then try again." };
  }
  const sol = lamports < SOL_TOPUP_BELOW ? SOL_TOPUP : 0;
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
    lastGrant.set(key, now);
    recentGrants.push(now);
    if (sol > 0) recentTopups.push(now);
    return {
      ok: true, network: "devnet", symbol, signature, sentRaw: GRANT_RAW.toString(), sentShares: market ? 1 : 5,
      sentSol: sol / LAMPORTS_PER_SOL, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    };
  } catch (e) {
    return { ok: false, status: 503, error: `Faucet transaction failed: ${String((e as Error).message).split("\n")[0].slice(0, 160)}` };
  }
}
