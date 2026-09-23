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
import { ROOT, issuerKeypair, readConfig } from "../scripts/lib/env";

const conn = new Connection("http://127.0.0.1:8899", "confirmed");
const cfg = readConfig();
const SPACEX = new PublicKey(cfg.replicaSpacex!);
const SPCXX = new PublicKey(cfg.replicaSpcxx!);
const POOL = new PublicKey(cfg.pool!);
const EXPIRY = Math.floor(Date.parse("2027-03-12T23:59:00Z") / 1000);
const FALLBACK = Math.floor(Date.parse("2027-03-01T00:00:00Z") / 1000);
const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "idl/holdfill_orders.json"), "utf8"));

const issuer = issuerKeypair();
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
  await mintTo(conn, issuer, SPACEX, ata(h.publicKey, SPACEX), issuer, rawTokens, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
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
