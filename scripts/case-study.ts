// Writes data/case-study.json from mainnet: one real holder's sale on the SPACEX/SPCXx pool at a
// deep gap, and how many wallets still held xAI PreStocks after its conversion deadline.
//
// The sale: wallet CQ8s...FNnn on 12 Jul 2026, the highest-volume day in the history snapshot. It was
// found by parsing every pool transaction on the deepest-gap days (16 Jun, 18 Jun, 12 Jul) and taking
// the wallet that sold the most SPACEX through the pool. Everything below is recomputed from chain.
// Amounts are the pool leg only: SPACEX the pool received and SPCXx it paid out, so a swap that an
// aggregator split across venues counts only the part that went through this pool.
import fs from "node:fs";
import path from "node:path";
import { MAINNET, ROOT } from "./lib/env";

const OUT = path.join(ROOT, "data/case-study.json");
const WALLET = "CQ8snoiZ3CTxsQoG9wJic4axkAb2Cmzen684iY2GFNnn";
const DAY = "2026-07-12";
const XAI = "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx";
const XAI_TERMS = {
  text: "xAI was acquired by SpaceX. Each XAI token must be swapped into 0.7165 SPACEX before 11:59pm UTC on 12 September 2026, or it will expire worthless.",
  source: "https://prestocks.com/xai",
  deadline: "2026-09-12T23:59:00Z",
};
const SHARES_PER_TOKEN = 5;
const POOL = MAINNET.pool.toBase58();
const SPACEX = MAINNET.spacex.toBase58();
const SPCXX = MAINNET.spcxx.toBase58();
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const URL = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Raw JSON-RPC: web3.js 1.x cannot request version 1 transactions. Retries with backoff on the free tier's 429s.
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error));
      return body.result as T;
    } catch (e) {
      if (attempt >= 8) throw e;
      await sleep(Math.min(30_000, 1000 * 2 ** attempt));
    }
  }
}

type Balance = { accountIndex: number; mint: string; owner: string; uiTokenAmount: { amount: string } };
type Tx = { slot: number; blockTime: number; meta: { err: unknown; preTokenBalances: Balance[]; postTokenBalances: Balance[] } };

/** Net base-unit change per owner for one mint. */
function deltas(tx: Tx, mint: string): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const pre = tx.meta.preTokenBalances.filter((b) => b.mint === mint);
  const post = tx.meta.postTokenBalances.filter((b) => b.mint === mint);
  for (const i of new Set([...pre, ...post].map((b) => b.accountIndex))) {
    const a = pre.find((b) => b.accountIndex === i), b = post.find((x) => x.accountIndex === i);
    const owner = (b ?? a)!.owner;
    const d = BigInt(b?.uiTokenAmount.amount ?? 0) - BigInt(a?.uiTokenAmount.amount ?? 0);
    if (d !== 0n) out.set(owner, (out.get(owner) ?? 0n) + d);
  }
  return out;
}

const ownerBalance = (list: Balance[], mint: string) =>
  list.filter((b) => b.owner === WALLET && b.mint === mint).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);

async function allSignatures(address: string, from: number, to: number) {
  const sigs: { signature: string; blockTime: number; err: unknown }[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await rpc<typeof sigs>("getSignaturesForAddress", [address, { limit: 1000, ...(before ? { before } : {}) }]);
    if (page.length === 0) break;
    sigs.push(...page.filter((s) => !s.err && s.blockTime >= from && s.blockTime < to));
    before = page[page.length - 1].signature;
    if (page.length < 1000 || page[page.length - 1].blockTime < from) break;
  }
  return sigs;
}

async function sale() {
  const from = Date.parse(`${DAY}T00:00:00Z`) / 1000, to = from + 86_400;
  const accounts = await rpc<{ value: { pubkey: string }[] }>("getTokenAccountsByOwner", [WALLET, { mint: SPACEX }, { encoding: "jsonParsed" }]);
  const spacexAccount = accounts.value[0].pubkey;
  const sigs = await allSignatures(spacexAccount, from, to);

  const txs: { sig: string; tx: Tx }[] = [];
  for (let i = 0; i < sigs.length; i += 3) {
    const batch = await Promise.all(sigs.slice(i, i + 3).map(async (s) => ({
      sig: s.signature,
      tx: await rpc<Tx>("getTransaction", [s.signature, { maxSupportedTransactionVersion: 1, encoding: "jsonParsed" }]),
    })));
    txs.push(...batch);
  }
  txs.sort((a, b) => a.tx.blockTime - b.tx.blockTime || a.tx.slot - b.tx.slot);

  let buys = 0, soldTotal = 0n, poolIn = 0n, poolOut = 0n;
  const legs: { sig: string; time: string; walletSold: bigint; poolIn: bigint; poolOut: bigint }[] = [];
  for (const { sig, tx } of txs) {
    const dx = deltas(tx, SPACEX), dy = deltas(tx, SPCXX);
    const mine = dx.get(WALLET) ?? 0n;
    if (mine > 0n) buys++;
    if (mine >= 0n) continue;
    soldTotal += -mine;
    const inPool = dx.get(POOL) ?? 0n, outPool = -(dy.get(POOL) ?? 0n);
    if (inPool > 0n && outPool > 0n) {
      poolIn += inPool; poolOut += outPool;
      legs.push({ sig, time: new Date(tx.blockTime * 1000).toISOString(), walletSold: -mine, poolIn: inPool, poolOut: outPool });
    }
  }
  if (legs.length === 0) throw new Error("no pool sells found for the wallet on that day");

  const first = txs[0].tx, last = txs[txs.length - 1].tx;
  const balanceBefore = ownerBalance(first.meta.preTokenBalances, SPACEX);
  const balanceAfter = ownerBalance(last.meta.postTokenBalances, SPACEX);
  const now = await rpc<{ value: { amount: string } }>("getTokenAccountBalance", [spacexAccount]);

  // Featured transaction: the day's first sale at the largest size that went entirely through the pool.
  const whole = legs.filter((l) => l.poolIn === l.walletSold);
  const size = whole.reduce((m, l) => (l.poolIn > m ? l.poolIn : m), 0n);
  const featured = whole.find((l) => l.poolIn === size)!;

  const raw = (v: bigint) => Number(v) / 1e9;
  const spcxx = (v: bigint) => Number(v) / 1e8;
  const gapPct = (i: bigint, o: bigint) => Number(((1 - spcxx(o) / (raw(i) * SHARES_PER_TOKEN)) * 100).toFixed(2));

  // Context from the committed daily-close snapshot.
  const history = JSON.parse(fs.readFileSync(path.join(ROOT, "data/haircut-history.json"), "utf8"));
  const close = history.days.find((d: { date: string }) => d.date === DAY);
  const firstUnder20 = history.days.find((d: { date: string; gapPct: number }) => d.date > DAY && d.gapPct <= 20);
  const nextUnlock = history.unlocks.dates.find((u: { date: string }) => u.date > DAY);
  const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

  return {
    wallet: WALLET,
    walletShort: `${WALLET.slice(0, 4)}...${WALLET.slice(-4)}`,
    date: DAY,
    spacexAccount,
    throughPool: {
      swaps: legs.length,
      spacexRaw: raw(poolIn),
      shares: raw(poolIn) * SHARES_PER_TOKEN,
      entitlementSpcxx: raw(poolIn) * SHARES_PER_TOKEN,
      receivedSpcxx: spcxx(poolOut),
      gapPct: gapPct(poolIn, poolOut),
      firstSwap: legs[0].time,
      lastSwap: legs[legs.length - 1].time,
    },
    featured: {
      signature: featured.sig,
      explorer: explorer(featured.sig),
      time: featured.time,
      spacexRaw: raw(featured.poolIn),
      shares: raw(featured.poolIn) * SHARES_PER_TOKEN,
      receivedSpcxx: spcxx(featured.poolOut),
      gapPct: gapPct(featured.poolIn, featured.poolOut),
      note: "Whole amount went through the Meteora pool; the SPCXx was routed on into USDC in the same transaction.",
    },
    holder: {
      spacexRawBefore: raw(balanceBefore),
      spacexRawAfterDay: raw(balanceAfter),
      soldThatDayAllVenuesRaw: raw(soldTotal),
      buysThatDay: buys,
      spacexRawNow: raw(BigInt(now.value.amount)),
    },
    context: {
      dailyCloseGapThatDay: close?.gapPct ?? null,
      firstCloseAtOrUnder20: firstUnder20 ? { date: firstUnder20.date, gapPct: firstUnder20.gapPct, daysLater: daysBetween(DAY, firstUnder20.date) } : null,
      nextDatedUnlock: nextUnlock ? { date: nextUnlock.date, label: nextUnlock.label, daysLater: daysBetween(DAY, nextUnlock.date) } : null,
    },
    signatures: legs.map((l) => l.sig),
  };
}

async function xai() {
  const slot = await rpc<number>("getSlot", []);
  const accounts = await rpc<{ account: { data: [string, string] } }[]>("getProgramAccounts", [TOKEN_2022, {
    encoding: "base64", dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: XAI } }],
  }]);
  const owners = new Set<string>();
  let held = 0n;
  for (const a of accounts) {
    const d = Buffer.from(a.account.data[0], "base64");
    const amount = d.readBigUInt64LE(32);
    if (amount > 0n) { owners.add(d.subarray(0, 32).toString("hex")); held += amount; }
  }
  return {
    mint: XAI,
    issuerTerms: XAI_TERMS,
    slot,
    checkedAt: new Date().toISOString(),
    walletsHolding: owners.size,
    xaiHeld: Number(held) / 1e9,
    method: "Token-2022 accounts for the mint with a nonzero balance, counted by unique owner",
  };
}

async function main() {
  if (!process.env.HELIUS_API_KEY) throw new Error("HELIUS_API_KEY is not set");
  const [s, x] = [await sale(), await xai()];
  const study = { command: "npm run case-study", ranAt: new Date().toISOString(), network: "mainnet", pool: POOL, sale: s, xai: x };
  fs.writeFileSync(OUT, JSON.stringify(study, null, 2) + "\n");
  const t = s.throughPool;
  console.log(`${s.walletShort} on ${s.date}: ${t.swaps} swaps through the pool, ${t.spacexRaw} raw SPACEX (${t.shares} shares) for ${t.receivedSpcxx.toFixed(4)} SPCXx, ${t.gapPct}% under entitlement`);
  console.log(`featured ${s.featured.signature.slice(0, 16)}: ${s.featured.spacexRaw} raw for ${s.featured.receivedSpcxx} SPCXx, ${s.featured.gapPct}% under`);
  console.log(`holder: ${s.holder.spacexRawBefore} raw before, ${s.holder.spacexRawAfterDay} after, ${s.holder.buysThatDay} buys that day, ${s.holder.spacexRawNow} now`);
  console.log(`XAI after its ${XAI_TERMS.deadline} deadline: ${x.walletsHolding} wallets hold ${x.xaiHeld.toFixed(2)} XAI (slot ${x.slot})`);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
