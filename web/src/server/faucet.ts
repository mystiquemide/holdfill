import "server-only";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { DEVNET, devnet, keypairFromEnv } from "./env";
import { orderAddress } from "./orders";

const GRANT_RAW = 1_000_000_000n;            // 1 replica SPACEX = 5 shares
const HOLDING_CAP_RAW = 500_000_000n;        // refuse wallets already holding 0.5 raw or more
const SOL_TOPUP = 0.02 * LAMPORTS_PER_SOL;   // covers order rent and fees
const SOL_TOPUP_BELOW = 0.005 * LAMPORTS_PER_SOL;
const WALLET_COOLDOWN_MS = 60 * 60 * 1000;
const GLOBAL_LIMIT_PER_HOUR = 20;

const lastGrant = new Map<string, number>();
const recentGrants: number[] = [];

export type FaucetResult =
  | { ok: true; network: "devnet"; signature: string; sentSpacexRaw: string; sentShares: number; sentSol: number; explorer: string }
  | { ok: false; status: 429 | 503; error: string; retryAt?: string };

export async function grant(owner: PublicKey): Promise<FaucetResult> {
  const now = Date.now();
  const key = owner.toBase58();
  while (recentGrants.length && now - recentGrants[0] > 60 * 60 * 1000) recentGrants.shift();
  if (recentGrants.length >= GLOBAL_LIMIT_PER_HOUR) {
    return { ok: false, status: 429, error: "The faucet is busy. Try again later.", retryAt: new Date(recentGrants[0] + 60 * 60 * 1000).toISOString() };
  }

  const conn = devnet();
  const spacexAta = getAssociatedTokenAddressSync(DEVNET.spacex, owner, false, TOKEN_2022_PROGRAM_ID);
  const spcxxAta = getAssociatedTokenAddressSync(DEVNET.spcxx, owner, false, TOKEN_2022_PROGRAM_ID);
  const [balance, lamports, order] = await Promise.all([
    conn.getTokenAccountBalance(spacexAta, "confirmed").then((b) => BigInt(b.value.amount)).catch(() => 0n),
    conn.getBalance(owner, "confirmed"),
    conn.getAccountInfo(orderAddress(owner), "confirmed"),
  ]);
  // Survives restarts: the chain itself says whether this wallet already has enough.
  if (balance >= HOLDING_CAP_RAW) {
    return { ok: false, status: 429, error: `This wallet already holds ${Number(balance) / 1e9} replica SPACEX. The faucet only tops up empty wallets.` };
  }
  // A wallet whose last order sold everything can refill right away; the hourly limit covers the rest.
  const last = lastGrant.get(key);
  const emptyAndIdle = balance === 0n && !order;
  if (!emptyAndIdle && last && now - last < WALLET_COOLDOWN_MS) {
    return { ok: false, status: 429, error: "One faucet request per wallet per hour.", retryAt: new Date(last + WALLET_COOLDOWN_MS).toISOString() };
  }

  const issuer = keypairFromEnv("ISSUER_KEYPAIR");
  const sol = lamports < SOL_TOPUP_BELOW ? SOL_TOPUP : 0;
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, spacexAta, owner, DEVNET.spacex, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(issuer.publicKey, spcxxAta, owner, DEVNET.spcxx, TOKEN_2022_PROGRAM_ID),
    createMintToCheckedInstruction(DEVNET.spacex, spacexAta, issuer.publicKey, GRANT_RAW, 9, [], TOKEN_2022_PROGRAM_ID),
  );
  if (sol > 0) tx.add(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: owner, lamports: sol }));

  try {
    const signature = await sendAndConfirmTransaction(conn, tx, [issuer], { commitment: "confirmed" });
    lastGrant.set(key, now);
    recentGrants.push(now);
    return {
      ok: true, network: "devnet", signature, sentSpacexRaw: GRANT_RAW.toString(), sentShares: 5,
      sentSol: sol / LAMPORTS_PER_SOL, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    };
  } catch (e) {
    return { ok: false, status: 503, error: `Faucet transaction failed: ${String((e as Error).message).split("\n")[0].slice(0, 160)}` };
  }
}
