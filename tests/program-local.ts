// Program test suite against a local validator that clones the devnet market (gate G2 included).
// Proves the order PDA can sign Meteora DLMM swap2 through CPI as the holder's token delegate,
// and that every enforcement path rejects what it should.
import fs from "node:fs";
import path from "node:path";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createApproveCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction, createMint, createRevokeInstruction,
  createSetTransferFeeInstruction, getAccount, getAssociatedTokenAddressSync, mintTo,
} from "@solana/spl-token";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { buildExecuteIx, OrderAccount } from "../keeper/execute-ix";
import { tick } from "../keeper/tick";
import { ROOT, faucetKeypair, issuerKeypair, readConfig } from "../scripts/lib/env";

const conn = new Connection("http://127.0.0.1:8899", "confirmed");
const cfg = readConfig();
const SPACEX = new PublicKey(cfg.replicaSpacex!);
const SPCXX = new PublicKey(cfg.replicaSpcxx!);
const POOL = new PublicKey(cfg.pool!);
const MARKET = (cfg.markets as Record<string, { mint: string; pool: string }> | undefined)?.ANTHROPIC;
if (!MARKET || !cfg.replicaUsdc) throw new Error("run npm run devnet:markets -- ANTHROPIC first");
const ANTH = new PublicKey(MARKET.mint);
const APOOL = new PublicKey(MARKET.pool);
const USDC = new PublicKey(cfg.replicaUsdc as string);
const EXPIRY = Math.floor(Date.parse("2027-03-12T23:59:00Z") / 1000);
const FALLBACK = Math.floor(Date.parse("2027-03-01T00:00:00Z") / 1000);
const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "idl/holdfill_orders.json"), "utf8"));

const issuer = issuerKeypair();
const faucet = faucetKeypair(); // mint authority of the cloned replica mints
const keeper = Keypair.generate();
const program = new Program(idl, new AnchorProvider(conn, new Wallet(issuer), { commitment: "confirmed" }));
const results: { name: string; pass: boolean; detail: string }[] = [];

const ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
const orderPda = (owner: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("order"), owner.toBuffer(), SPACEX.toBuffer()], program.programId)[0];
const eventPda = PublicKey.findProgramAddressSync([Buffer.from("event"), SPACEX.toBuffer()], program.programId)[0];

function errorCode(e: any): string {
  const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
  const anchor = logs.find((l) => l.includes("Error Code:"));
  if (anchor) return anchor.replace(/.*Error Code: (\w+).*/, "$1");
  const custom = logs.find((l) => /failed: /.test(l));
  return custom ? custom.replace(/.*failed: /, "") : String(e?.message ?? e).split("\n")[0].slice(0, 120);
}

async function expectPass(name: string, fn: () => Promise<string>) {
  try { const d = await fn(); results.push({ name, pass: true, detail: d }); console.log(`PASS  ${name}: ${d}`); }
  catch (e) { const d = errorCode(e); results.push({ name, pass: false, detail: d }); console.log(`FAIL  ${name}: ${d}`); }
}

async function expectReject(name: string, expected: string[], fn: () => Promise<unknown>) {
  try { await fn(); results.push({ name, pass: false, detail: "succeeded" }); console.log(`FAIL  ${name}: transaction succeeded`); }
  catch (e) {
    const code = errorCode(e);
    const ok = expected.some((x) => code.includes(x));
    results.push({ name, pass: ok, detail: code });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}: rejected with ${code}${ok ? "" : ` (expected ${expected.join(" or ")})`}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntilChainTime(unix: number) {
  for (;;) {
    const t = await conn.getBlockTime(await conn.getSlot("confirmed"));
    if (t !== null && t >= unix) return;
    await sleep(1000);
  }
}

async function waitUntilEpoch(epoch: number) {
  while ((await conn.getEpochInfo("confirmed")).epoch < epoch) await sleep(1000);
}

async function newHolder(rawTokens: bigint): Promise<Keypair> {
  const h = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(h.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(h.publicKey, ata(h.publicKey, SPACEX), h.publicKey, SPACEX, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(h.publicKey, ata(h.publicKey, SPCXX), h.publicKey, SPCXX, TOKEN_2022_PROGRAM_ID),
  ), [h]);
  await mintTo(conn, issuer, SPACEX, ata(h.publicKey, SPACEX), faucet, rawTokens, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  return h;
}

async function createOrder(holder: Keypair, size: BN, limitBps: number) {
  const pda = orderPda(holder.publicKey);
  const createIx = await program.methods
    .createOrder({ size, limitBps, fallbackTs: new BN(FALLBACK), fallbackFloorBps: 5000 })
    .accountsStrict({
      owner: holder.publicKey, event: eventPda, inputMint: SPACEX, ownerTokenIn: ata(holder.publicKey, SPACEX),
      order: pda, systemProgram: SystemProgram.programId,
    })
    .instruction();
  const approveIx = createApproveCheckedInstruction(ata(holder.publicKey, SPACEX), SPACEX, pda, holder.publicKey, BigInt(size.toString()), 9, [], TOKEN_2022_PROGRAM_ID);
  await sendAndConfirmTransaction(conn, new Transaction().add(createIx, approveIx), [holder]);
  return pda;
}

async function execute(pda: PublicKey, amount: BN, overrides = {}) {
  const order = (await (program.account as any).order.fetch(pda)) as OrderAccount;
  const { ix, quoteOut } = await buildExecuteIx({ program, connection: conn, orderPda: pda, order, amountIn: amount, keeper: keeper.publicKey, cluster: "devnet", overrides });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [keeper]);
  return { sig, quoteOut };
}

async function main() {
  await conn.confirmTransaction(await conn.requestAirdrop(issuer.publicKey, 5 * LAMPORTS_PER_SOL), "confirmed");
  await conn.confirmTransaction(await conn.requestAirdrop(keeper.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");

  await expectPass("register lifecycle event (SPACEX -> SPCXx, 5 shares per token, 12 Mar 2027)", async () => {
    const sig = await program.methods
      .registerEvent({ outputMint: SPCXX, pool: POOL, ratioNum: new BN(1), ratioDen: new BN(2), expiryTs: new BN(EXPIRY) })
      .accountsStrict({ admin: issuer.publicKey, inputMint: SPACEX, event: eventPda, systemProgram: SystemProgram.programId })
      .rpc();
    return sig.slice(0, 16);
  });

  await expectReject("register event from a non-admin key", ["Unauthorized"], async () => {
    // Fresh event address (keyed by SPCXx) so only the admin check can stop it.
    const other = await newHolder(0n);
    const freshEvent = PublicKey.findProgramAddressSync([Buffer.from("event"), SPCXX.toBuffer()], program.programId)[0];
    await program.methods
      .registerEvent({ outputMint: SPACEX, pool: POOL, ratioNum: new BN(1), ratioDen: new BN(2), expiryTs: new BN(EXPIRY) })
      .accountsStrict({ admin: other.publicKey, inputMint: SPCXX, event: freshEvent, systemProgram: SystemProgram.programId })
      .signers([other]).rpc();
  });

  // Holder A: reachable limit (40%).
  const a = await newHolder(1_000_000_000n);
  let pdaA = PublicKey.default;
  await expectPass("holder A creates order: 0.5 raw, 40% limit, approval to order PDA", async () => {
    pdaA = await createOrder(a, new BN(500_000_000), 4000);
    const acct = await getAccount(conn, ata(a.publicKey, SPACEX), "confirmed", TOKEN_2022_PROGRAM_ID);
    if (!acct.delegate?.equals(pdaA) || acct.delegatedAmount !== 500_000_000n) throw new Error("approval not set");
    return `order ${pdaA.toBase58().slice(0, 8)}, delegate = order PDA, allowance 500000000`;
  });

  await expectReject("substituted token program (legacy SPL Token)", ["WrongTokenProgram"], () =>
    execute(pdaA, new BN(100_000_000), { tokenXProgram: TOKEN_PROGRAM_ID }));
  await expectReject("host fee account supplied by the caller", ["HostFeeNotAllowed"], () =>
    execute(pdaA, new BN(100_000_000), { hostFeeIn: keeper.publicKey }));
  await expectReject("wrong reserve account", ["WrongPoolAccount"], () =>
    execute(pdaA, new BN(100_000_000), { reserveX: ata(a.publicKey, SPACEX) }));
  await expectReject("fill larger than the order", ["AmountExceedsRemaining"], () =>
    execute(pdaA, new BN(600_000_000)));

  await expectPass("G2: order PDA signs DLMM swap2 through CPI as delegate (0.1 raw)", async () => {
    const inBefore = (await getAccount(conn, ata(a.publicKey, SPACEX), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    const outBefore = (await getAccount(conn, ata(a.publicKey, SPCXX), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    const { sig } = await execute(pdaA, new BN(100_000_000));
    const inAfter = (await getAccount(conn, ata(a.publicKey, SPACEX), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    const outAfter = (await getAccount(conn, ata(a.publicKey, SPCXX), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    const order = await (program.account as any).order.fetch(pdaA);
    const keeperTokens = await conn.getTokenAccountsByOwner(keeper.publicKey, { programId: TOKEN_2022_PROGRAM_ID });
    if (inBefore - inAfter !== 100_000_000n) throw new Error(`spent ${inBefore - inAfter}`);
    if (outAfter - outBefore < 20_000_000n) throw new Error(`received ${outAfter - outBefore} below the 40% minimum`);
    if (keeperTokens.value.length !== 0) throw new Error("keeper holds token accounts");
    const perShare = Number(outAfter - outBefore) / 1e8 / 0.5;
    return `spent 0.1 raw, received ${Number(outAfter - outBefore) / 1e8} SPCXx (${(100 * (1 - perShare)).toFixed(1)}% gap), order filled ${order.filled}/${order.size}, keeper holds nothing, sig ${sig.slice(0, 16)}`;
  });

  await expectPass("second partial fill accumulates (0.2 raw)", async () => {
    await execute(pdaA, new BN(200_000_000));
    const order = await (program.account as any).order.fetch(pdaA);
    if (order.filled.toString() !== "300000000") throw new Error(`filled ${order.filled}`);
    return `filled ${order.filled}/${order.size}, received ${order.received}`;
  });

  await expectPass("holder A revokes and cancels in one transaction", async () => {
    const cancelIx = await program.methods.cancelOrder().accountsStrict({ owner: a.publicKey, order: pdaA }).instruction();
    await sendAndConfirmTransaction(conn, new Transaction().add(cancelIx, createRevokeInstruction(ata(a.publicKey, SPACEX), a.publicKey, [], TOKEN_2022_PROGRAM_ID)), [a]);
    return "order closed, approval removed";
  });
  await expectReject("fill after revoke and cancel", ["AccountNotInitialized", "3012", "could not find", "Account does not exist"], () =>
    execute(pdaA, new BN(100_000_000)));

  // Holder B: unreachable limit (10%) while the pool pays about 29% under entitlement.
  const b = await newHolder(1_000_000_000n);
  const pdaB = await createOrder(b, new BN(500_000_000), 1000);
  await expectReject("fill below the holder's minimum (10% limit)", ["ExceededAmountSlippageTolerance", "InsufficientOutput", "0x1773"], () =>
    execute(pdaB, new BN(100_000_000)));

  await expectReject("create order with limit above 60%", ["InvalidLimit"], async () => {
    const c = await newHolder(1_000_000_000n);
    await createOrder(c, new BN(100_000_000), 7000);
  });

  // Holder D: wrong output account, then filling the whole order.
  const d = await newHolder(1_000_000_000n);
  const pdaD = await createOrder(d, new BN(200_000_000), 4000);
  await expectReject("output sent to someone else's SPCXx account", ["WrongOwnerAccount"], () =>
    execute(pdaD, new BN(100_000_000), { userTokenOut: ata(a.publicKey, SPCXX) }));
  await expectPass("order fills its full size and becomes Filled", async () => {
    await execute(pdaD, new BN(200_000_000));
    const order = await (program.account as any).order.fetch(pdaD);
    if (!("filled" in order.status)) throw new Error(`status ${JSON.stringify(order.status)}`);
    return `filled ${order.filled}/${order.size}, status Filled, received ${order.received}`;
  });
  await expectReject("fill on a filled order", ["OrderNotActive"], () =>
    execute(pdaD, new BN(100_000_000)));

  // Holder E: limit unreachable (10%) but the fallback date arrives, so the 50% floor applies.
  const e = await newHolder(1_000_000_000n);
  const pdaE = PublicKey.findProgramAddressSync([Buffer.from("order"), e.publicKey.toBuffer(), SPACEX.toBuffer()], program.programId)[0];
  const fallbackSoon = Math.floor(Date.now() / 1000) + 20;
  await sendAndConfirmTransaction(conn, new Transaction().add(
    await program.methods
      .createOrder({ size: new BN(100_000_000), limitBps: 1000, fallbackTs: new BN(fallbackSoon), fallbackFloorBps: 5000 })
      .accountsStrict({ owner: e.publicKey, event: eventPda, inputMint: SPACEX, ownerTokenIn: ata(e.publicKey, SPACEX), order: pdaE, systemProgram: SystemProgram.programId })
      .instruction(),
    createApproveCheckedInstruction(ata(e.publicKey, SPACEX), SPACEX, pdaE, e.publicKey, 100_000_000n, 9, [], TOKEN_2022_PROGRAM_ID),
  ), [e]);
  await expectReject("before the fallback date, a 10% limit does not fill", ["ExceededAmountSlippageTolerance", "InsufficientOutput"], () =>
    execute(pdaE, new BN(100_000_000)));
  await waitUntilChainTime(fallbackSoon + 2);
  await expectPass("after the fallback date, the 50% floor applies and the order fills", async () => {
    await execute(pdaE, new BN(100_000_000));
    const order = await (program.account as any).order.fetch(pdaE);
    return `filled ${order.filled}/${order.size} at the fallback floor, received ${order.received}`;
  });

  // A second input token whose issuer deadline passes during the test.
  const expiringMint = await createMint(conn, issuer, issuer.publicKey, null, 9, Keypair.generate(), { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  const shortEvent = PublicKey.findProgramAddressSync([Buffer.from("event"), expiringMint.toBuffer()], program.programId)[0];
  const shortExpiry = Math.floor(Date.now() / 1000) + 30;
  await program.methods
    .registerEvent({ outputMint: SPCXX, pool: POOL, ratioNum: new BN(1), ratioDen: new BN(2), expiryTs: new BN(shortExpiry) })
    .accountsStrict({ admin: issuer.publicKey, inputMint: expiringMint, event: shortEvent, systemProgram: SystemProgram.programId })
    .rpc();
  const f = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(f.publicKey, LAMPORTS_PER_SOL), "confirmed");
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(f.publicKey, ata(f.publicKey, expiringMint), f.publicKey, expiringMint, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(f.publicKey, ata(f.publicKey, SPCXX), f.publicKey, SPCXX, TOKEN_2022_PROGRAM_ID),
  ), [f]);
  await mintTo(conn, issuer, expiringMint, ata(f.publicKey, expiringMint), issuer, 1_000_000_000n, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  const pdaF = PublicKey.findProgramAddressSync([Buffer.from("order"), f.publicKey.toBuffer(), expiringMint.toBuffer()], program.programId)[0];
  await sendAndConfirmTransaction(conn, new Transaction().add(
    await program.methods
      .createOrder({ size: new BN(100_000_000), limitBps: 4000, fallbackTs: new BN(shortExpiry - 10), fallbackFloorBps: 5000 })
      .accountsStrict({ owner: f.publicKey, event: shortEvent, inputMint: expiringMint, ownerTokenIn: ata(f.publicKey, expiringMint), order: pdaF, systemProgram: SystemProgram.programId })
      .instruction(),
    createApproveCheckedInstruction(ata(f.publicKey, expiringMint), expiringMint, pdaF, f.publicKey, 100_000_000n, 9, [], TOKEN_2022_PROGRAM_ID),
  ), [f]);
  await waitUntilChainTime(shortExpiry + 2);
  await expectReject("fill after the issuer deadline", ["IssuerDeadlinePassed"], async () => {
    // Pool accounts come from the SPACEX pool; the order's own mint and token account are swapped in.
    const orderF = (await (program.account as any).order.fetch(pdaF)) as OrderAccount;
    const { ix } = await buildExecuteIx({
      program, connection: conn, orderPda: pdaF, order: { ...orderF, inputMint: SPACEX }, amountIn: new BN(100_000_000),
      keeper: keeper.publicKey, cluster: "devnet",
      overrides: { tokenXMint: expiringMint, userTokenIn: ata(f.publicKey, expiringMint) },
    });
    await sendAndConfirmTransaction(conn, new Transaction().add(ix), [keeper]);
  });

  // ---------- v2: price orders into USDC (classic SPL Token output) ----------
  const orderFor = (owner: PublicKey, mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("order"), owner.toBuffer(), mint.toBuffer()], program.programId)[0];
  const usdcAta = (owner: PublicKey) => getAssociatedTokenAddressSync(USDC, owner, false, TOKEN_PROGRAM_ID);
  const eventFor = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("event"), mint.toBuffer()], program.programId)[0];

  async function marketHolder(raw: bigint): Promise<Keypair> {
    const h = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(h.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");
    await sendAndConfirmTransaction(conn, new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(h.publicKey, ata(h.publicKey, ANTH), h.publicKey, ANTH, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountIdempotentInstruction(h.publicKey, usdcAta(h.publicKey), h.publicKey, USDC, TOKEN_PROGRAM_ID),
    ), [h]);
    await mintTo(conn, issuer, ANTH, ata(h.publicKey, ANTH), faucet, raw, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
    return h;
  }

  async function createPriceOrder(h: Keypair, p: { size: bigint; usdPerToken: number; expiry: number; mint?: PublicKey; output?: PublicKey; pool?: PublicKey }) {
    const mint = p.mint ?? ANTH;
    const pda = orderFor(h.publicKey, mint);
    const ix = await program.methods
      .createPriceOrder({ size: new BN(p.size.toString()), minOutPerToken: new BN(Math.round(p.usdPerToken * 1e6)), expiryTs: new BN(p.expiry) })
      .accountsStrict({
        owner: h.publicKey, inputMint: mint, outputMint: p.output ?? USDC, pool: p.pool ?? APOOL, event: eventFor(mint),
        ownerTokenIn: ata(h.publicKey, mint), order: pda, systemProgram: SystemProgram.programId,
      })
      .instruction();
    const approve = createApproveCheckedInstruction(ata(h.publicKey, mint), mint, pda, h.publicKey, p.size, 9, [], TOKEN_2022_PROGRAM_ID);
    await sendAndConfirmTransaction(conn, new Transaction().add(ix, approve), [h]);
    return pda;
  }

  const inAYear = Math.floor(Date.now() / 1000) + 300 * 86_400;
  const p1 = await marketHolder(1_000_000_000n);
  let pdaP1 = PublicKey.default;
  await expectPass("price order: 0.5 ANTHROPIC at a $800 minimum, approval to order PDA", async () => {
    pdaP1 = await createPriceOrder(p1, { size: 500_000_000n, usdPerToken: 800, expiry: inAYear });
    const o = await (program.account as any).order.fetch(pdaP1);
    if (!o.outputMint.equals(USDC) || o.ratioNum.toString() !== "800000000" || o.ratioDen.toString() !== "1000000000" || o.limitBps !== 0) throw new Error("terms not stored");
    return `order ${pdaP1.toBase58().slice(0, 8)}, min 800 USDC per token, expiry in 300 days`;
  });
  await expectReject("output token program swapped for Token-2022 while USDC is classic", ["WrongTokenProgram"], () =>
    execute(pdaP1, new BN(100_000_000), { tokenYProgram: TOKEN_2022_PROGRAM_ID }));
  await expectPass("price order fills into classic-token USDC above the holder's price (0.2 token)", async () => {
    const before = (await getAccount(conn, usdcAta(p1.publicKey), "confirmed", TOKEN_PROGRAM_ID)).amount;
    await execute(pdaP1, new BN(200_000_000));
    const got = (await getAccount(conn, usdcAta(p1.publicKey), "confirmed", TOKEN_PROGRAM_ID)).amount - before;
    if (got < 160_000_000n) throw new Error(`received ${got} below the $800 minimum`);
    return `0.2 token -> ${Number(got) / 1e6} USDC (${(Number(got) / 1e6 / 0.2).toFixed(2)} per token, min 800)`;
  });

  const p2 = await marketHolder(1_000_000_000n);
  const pdaP2 = await createPriceOrder(p2, { size: 200_000_000n, usdPerToken: 2000, expiry: inAYear });
  await expectPass("keeper fills the rest of the price order into USDC", async () => {
    const [a1] = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: pdaP1 });
    if (a1?.action !== "filled") throw new Error(`${a1?.action}: ${a1?.reason}`);
    const o = await (program.account as any).order.fetch(pdaP1);
    return `${a1.reason}, ${Number(a1.amountIn) / 1e9} token, order ${o.filled}/${o.size}`;
  });
  await expectReject("price order above what the pool pays ($2,000) does not fill", ["ExceededAmountSlippageTolerance", "InsufficientOutput"], () =>
    execute(pdaP2, new BN(100_000_000)));

  await expectReject("price order on a pool that trades a different pair", ["WrongPoolMints"], async () => {
    const h = await marketHolder(1_000_000_000n);
    await createPriceOrder(h, { size: 100_000_000n, usdPerToken: 800, expiry: inAYear, pool: POOL });
  });
  await expectReject("price order that outlives the issuer deadline (SPACEX)", ["InvalidExpiry"], async () => {
    const h = await newHolder(1_000_000_000n);
    await createPriceOrder(h, { size: 100_000_000n, usdPerToken: 1, expiry: EXPIRY + 86_400, mint: SPACEX, output: SPCXX, pool: POOL });
  });

  const p3 = await marketHolder(1_000_000_000n);
  const shortPrice = Math.floor(Date.now() / 1000) + 20;
  const pdaP3 = await createPriceOrder(p3, { size: 100_000_000n, usdPerToken: 800, expiry: shortPrice });
  await waitUntilChainTime(shortPrice + 2);
  await expectReject("price order after its expiry", ["IssuerDeadlinePassed"], () => execute(pdaP3, new BN(100_000_000)));

  // ---------- v2: arm for IPO, then the issuer names a successor ----------
  async function armOrder(h: Keypair, p: { size: bigint; limitBps: number; days: number; mint?: PublicKey }) {
    const mint = p.mint ?? ANTH;
    const pda = orderFor(h.publicKey, mint);
    const ix = await program.methods
      .armOrder({ size: new BN(p.size.toString()), limitBps: p.limitBps, fallbackDaysBefore: p.days, fallbackFloorBps: 5000 })
      .accountsStrict({ owner: h.publicKey, inputMint: mint, event: eventFor(mint), ownerTokenIn: ata(h.publicKey, mint), order: pda, systemProgram: SystemProgram.programId })
      .instruction();
    const approve = createApproveCheckedInstruction(ata(h.publicKey, mint), mint, pda, h.publicKey, p.size, 9, [], TOKEN_2022_PROGRAM_ID);
    await sendAndConfirmTransaction(conn, new Transaction().add(ix, approve), [h]);
    return pda;
  }
  // The keeper, not the holder or the admin, pays for and sends the activation.
  const activate = async (pda: PublicKey) => {
    const ix = await program.methods.activate().accountsStrict({ order: pda, event: eventFor(ANTH) }).instruction();
    return sendAndConfirmTransaction(conn, new Transaction().add(ix), [keeper]);
  };

  const r1 = await marketHolder(1_000_000_000n);
  let pdaR1 = PublicKey.default;
  await expectPass("arm an ANTHROPIC order before any issuer event (20% limit, fallback 30 days before)", async () => {
    pdaR1 = await armOrder(r1, { size: 300_000_000n, limitBps: 2000, days: 30 });
    const o = await (program.account as any).order.fetch(pdaR1);
    if (!("armed" in o.status) || o.fallbackTs.toString() !== String(30 * 86_400)) throw new Error(`status ${JSON.stringify(o.status)}`);
    return `order ${pdaR1.toBase58().slice(0, 8)} armed, approval to order PDA, no output or pool yet`;
  });
  await expectPass("revoke an armed order", async () => {
    const h = await marketHolder(1_000_000_000n);
    const pda = await armOrder(h, { size: 100_000_000n, limitBps: 2000, days: 30 });
    const cancelIx = await program.methods.cancelOrder().accountsStrict({ owner: h.publicKey, order: pda }).instruction();
    await sendAndConfirmTransaction(conn, new Transaction().add(cancelIx, createRevokeInstruction(ata(h.publicKey, ANTH), h.publicKey, [], TOKEN_2022_PROGRAM_ID)), [h]);
    if (await conn.getAccountInfo(pda)) throw new Error("order still exists");
    return "armed order closed, approval removed";
  });
  const r2 = await marketHolder(1_000_000_000n);
  const pdaR2 = await armOrder(r2, { size: 200_000_000n, limitBps: 2000, days: 30 });
  // r3 never held the output token: no account to receive into until the keeper creates one.
  const r3 = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(r3.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(r3.publicKey, ata(r3.publicKey, ANTH), r3.publicKey, ANTH, TOKEN_2022_PROGRAM_ID),
  ), [r3]);
  await mintTo(conn, issuer, ANTH, ata(r3.publicKey, ANTH), faucet, 1_000_000_000n, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  const pdaR3 = await armOrder(r3, { size: 100_000_000n, limitBps: 2000, days: 30 });
  await expectPass("keeper leaves an armed order alone while no event exists", async () => {
    const out = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: pdaR2 });
    if (out.length) throw new Error(`${out[0].action}: ${out[0].reason}`);
    return "no attempt";
  });
  await expectReject("an armed order cannot fill", ["WrongPool", "OrderNotActive"], async () => {
    const o = (await (program.account as any).order.fetch(pdaR1)) as OrderAccount;
    const { ix } = await buildExecuteIx({ program, connection: conn, orderPda: pdaR1, order: { ...o, pool: APOOL, outputMint: USDC }, amountIn: new BN(100_000_000), keeper: keeper.publicKey, cluster: "devnet" });
    await sendAndConfirmTransaction(conn, new Transaction().add(ix), [keeper]);
  });
  await expectReject("activate before the issuer names a successor", ["AccountNotInitialized", "3012"], () => activate(pdaR1));
  await expectReject("arm a token that already has an event (SPACEX)", ["EventAlreadyRegistered"], async () => {
    const h = await newHolder(1_000_000_000n);
    await armOrder(h, { size: 100_000_000n, limitBps: 2000, days: 30, mint: SPACEX });
  });

  await expectPass("issuer registers the event: ANTHROPIC into USDC at 1,100 per token (local only)", async () => {
    const sig = await program.methods
      .registerEvent({ outputMint: USDC, pool: APOOL, ratioNum: new BN(11), ratioDen: new BN(10), expiryTs: new BN(EXPIRY) })
      .accountsStrict({ admin: issuer.publicKey, inputMint: ANTH, event: eventFor(ANTH), systemProgram: SystemProgram.programId })
      .rpc();
    return sig.slice(0, 16);
  });
  await expectPass("anyone activates the armed order with the issuer's terms", async () => {
    await activate(pdaR1);
    const o = await (program.account as any).order.fetch(pdaR1);
    if (!("active" in o.status) || !o.pool.equals(APOOL) || o.fallbackTs.toNumber() !== EXPIRY - 30 * 86_400) throw new Error(JSON.stringify(o.status));
    return `active, output USDC, fallback ${new Date(o.fallbackTs.toNumber() * 1000).toISOString().slice(0, 10)}, limit 20% kept`;
  });
  await expectPass("the activated order fills above its 20% limit (0.1 token)", async () => {
    const before = (await getAccount(conn, usdcAta(r1.publicKey), "confirmed", TOKEN_PROGRAM_ID)).amount;
    await execute(pdaR1, new BN(100_000_000));
    const got = (await getAccount(conn, usdcAta(r1.publicKey), "confirmed", TOKEN_PROGRAM_ID)).amount - before;
    if (got < 88_000_000n) throw new Error(`received ${got} below the 88 USDC minimum`);
    return `0.1 token -> ${Number(got) / 1e6} USDC (min 88 = 1,100 x 0.1 x 80%)`;
  });
  await expectReject("activate an order that is already active", ["NotArmed"], () => activate(pdaR1));
  await expectPass("keeper activates an armed order once the event exists, then fills it", async () => {
    const [first] = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: pdaR2 });
    if (first?.action !== "activated") throw new Error(`${first?.action}: ${first?.reason}`);
    const [second] = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: pdaR2 });
    if (second?.action !== "filled") throw new Error(`${second?.action}: ${second?.reason}`);
    return `activated, then ${second.reason} (${Number(second.amountIn) / 1e9} token)`;
  });
  await expectPass("keeper creates the holder's output account when it is missing, then fills", async () => {
    if (await conn.getAccountInfo(usdcAta(r3.publicKey))) throw new Error("output account already existed");
    const [first] = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: pdaR3 });
    if (first?.action !== "activated") throw new Error(`${first?.action}: ${first?.reason}`);
    const [second] = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: pdaR3 });
    if (second?.action !== "filled") throw new Error(`${second?.action}: ${second?.reason}`);
    const out = await getAccount(conn, usdcAta(r3.publicKey), "confirmed", TOKEN_PROGRAM_ID);
    if (!out.owner.equals(r3.publicKey)) throw new Error("output account not owned by the holder");
    const keeperTokens = (await conn.getTokenAccountsByOwner(keeper.publicKey, { programId: TOKEN_PROGRAM_ID })).value.length;
    if (keeperTokens) throw new Error("keeper holds token accounts");
    return `account created for the holder, ${Number(out.amount) / 1e6} USDC received, keeper holds nothing`;
  });

  // Issuer raises the transfer fee; it takes effect two epochs later.
  const g = await newHolder(1_000_000_000n);
  const pdaG = await createOrder(g, new BN(100_000_000), 4000);
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createSetTransferFeeInstruction(SPACEX, issuer.publicKey, [], 200, BigInt("18446744073709551615"), TOKEN_2022_PROGRAM_ID),
  ), [issuer]);
  const feeEpoch = (await conn.getEpochInfo()).epoch + 2;
  await waitUntilEpoch(feeEpoch);
  await expectReject("fill after the issuer changed the transfer fee", ["FeeChanged"], () =>
    execute(pdaG, new BN(100_000_000)));

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data/program-local.json"), JSON.stringify({ ranAt: new Date().toISOString(), network: "local validator cloned from devnet", results }, null, 2) + "\n");
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error("TEST ERROR", errorCode(e)); process.exit(2); });
