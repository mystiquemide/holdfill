// Records devnet proof transactions for the v2 order kinds:
//   Price orders on replica ANTHROPIC into replica USDC: created, filled by the keeper, and a
//   second order whose price the pool cannot pay, refused on chain.
//   Arm for IPO on a separate demo token: armed with no event, a simulated issuer event,
//   activation by the keeper, and a fill at the armed limit.
// The demo token exists only for this proof. Its event is simulated and labeled so; no real
// issuer has announced one. Replica ANTHROPIC and OPENAI never get an event.
import fs from "node:fs";
import path from "node:path";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createApproveCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction, getAccount, getAssociatedTokenAddressSync, mintTo,
} from "@solana/spl-token";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import { buildExecuteIx, OrderAccount } from "../keeper/execute-ix";
import { tick } from "../keeper/tick";
import { ROOT, devnet, issuerKeypair, faucetKeypair, loadKeypair, readConfig, writeConfig } from "./lib/env";
import { createPair, seedLiquidity } from "./lib/pool";
import { createReplicaMint, mintInventory } from "./lib/replica";

const EXPIRY = Math.floor(Date.parse("2027-03-12T23:59:00Z") / 1000);
const KEYS = "/root/.config/holdfill";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

function keypairFile(name: string): Keypair {
  const file = path.join(KEYS, `${name}.json`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  return loadKeypair("__unused__", file);
}

type Demo = { mint?: string; successor?: string; pool?: string; positions?: string[]; event?: string };

async function main() {
  const conn: Connection = devnet();
  const cfg = readConfig();
  const issuer = issuerKeypair();
  const keeper = keypairFile("keeper");
  const holder = keypairFile("v2-holder");
  const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "idl/holdfill_orders.json"), "utf8"));
  const program = new Program(idl, new AnchorProvider(conn, new Wallet(issuer), { commitment: "confirmed" }));
  const markets = cfg.markets as Record<string, { mint: string; pool: string }>;
  const ANTH = new PublicKey(markets.ANTHROPIC.mint), APOOL = new PublicKey(markets.ANTHROPIC.pool);
  const USDC = new PublicKey(cfg.replicaUsdc as string);
  const ata2022 = (o: PublicKey, m: PublicKey) => getAssociatedTokenAddressSync(m, o, false, TOKEN_2022_PROGRAM_ID);
  const usdcAta = (o: PublicKey) => getAssociatedTokenAddressSync(USDC, o, false, TOKEN_PROGRAM_ID);
  const orderFor = (o: PublicKey, m: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("order"), o.toBuffer(), m.toBuffer()], program.programId)[0];
  const eventFor = (m: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("event"), m.toBuffer()], program.programId)[0];

  const proof: Record<string, { signature: string; explorer: string; result: string; detail?: string }> = {};
  const record = (name: string, signature: string, result: string, detail?: string) => {
    proof[name] = { signature, explorer: explorer(signature), result, ...(detail ? { detail } : {}) };
    console.log(`${name}: ${result}${detail ? ` (${detail})` : ""}\n  ${explorer(signature)}`);
  };

  for (const [kp, sol] of [[holder, 0.06], [keeper, 0.05]] as const) {
    if ((await conn.getBalance(kp.publicKey)) < (sol * LAMPORTS_PER_SOL) / 2) {
      await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: issuer.publicKey, toPubkey: kp.publicKey, lamports: sol * LAMPORTS_PER_SOL })), [issuer]);
    }
  }

  /** Sends without preflight so a refused fill lands on chain; returns signature and error code. */
  async function sendLanding(ix: TransactionInstruction): Promise<{ sig: string; err: string | null }> {
    const tx = new Transaction().add(ix);
    tx.feePayer = keeper.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(keeper);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(sig, "confirmed").catch(() => null);
    const got = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const logs = got?.meta?.logMessages ?? [];
    return { sig, err: logs.find((l) => l.includes("Error Code:"))?.replace(/.*Error Code: (\w+).*/, "$1") ?? (got?.meta?.err ? JSON.stringify(got.meta.err) : null) };
  }

  // ---------- 1. Price orders: replica ANTHROPIC into replica USDC ----------
  if (await conn.getAccountInfo(orderFor(holder.publicKey, ANTH))) throw new Error("v2 holder already has an ANTHROPIC order; close it before re-running");
  await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(holder.publicKey, ata2022(holder.publicKey, ANTH), holder.publicKey, ANTH, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(holder.publicKey, usdcAta(holder.publicKey), holder.publicKey, USDC, TOKEN_PROGRAM_ID),
  ), [holder]);
  const anthBal = (await getAccount(conn, ata2022(holder.publicKey, ANTH), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  if (anthBal < 1_000_000_000n) await mintTo(conn, issuer, ANTH, ata2022(holder.publicKey, ANTH), faucetKeypair(), 1_000_000_000n - anthBal, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);

  const priceOrder = async (size: bigint, usd: number) => {
    const pda = orderFor(holder.publicKey, ANTH);
    const ix = await program.methods
      .createPriceOrder({ size: new BN(size.toString()), minOutPerToken: new BN(usd * 1e6), expiryTs: new BN(Math.floor(Date.now() / 1000) + 180 * 86_400) })
      .accountsStrict({ owner: holder.publicKey, inputMint: ANTH, outputMint: USDC, pool: APOOL, event: eventFor(ANTH), ownerTokenIn: ata2022(holder.publicKey, ANTH), order: pda, systemProgram: SystemProgram.programId })
      .instruction();
    const approve = createApproveCheckedInstruction(ata2022(holder.publicKey, ANTH), ANTH, pda, holder.publicKey, size, 9, [], TOKEN_2022_PROGRAM_ID);
    return { pda, sig: await sendAndConfirmTransaction(conn, new Transaction().add(ix, approve), [holder], { commitment: "confirmed" }) };
  };

  const p1 = await priceOrder(300_000_000n, 800);
  record("priceOrderCreated", p1.sig, "confirmed", "0.3 replica ANTHROPIC, at least 800 USDC per token, expires in 180 days, approval to order PDA");
  await sleep(800);
  const [fill] = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: p1.pda });
  if (fill?.action !== "filled" || !fill.signature) throw new Error(`price order did not fill: ${fill?.action} ${fill?.reason}`);
  const perToken = Number(fill.quotedOut) / 1e6 / (Number(fill.amountIn) / 1e9);
  record("priceFilled", fill.signature, "confirmed", `keeper sold ${Number(fill.amountIn) / 1e9} replica ANTHROPIC for about ${(Number(fill.quotedOut) / 1e6).toFixed(2)} replica USDC (${perToken.toFixed(2)} per token, minimum 800)`);
  await sleep(800);
  const close = await program.methods.cancelOrder().accountsStrict({ owner: holder.publicKey, order: p1.pda }).instruction();
  await sendAndConfirmTransaction(conn, new Transaction().add(close), [holder], { commitment: "confirmed" });

  const p2 = await priceOrder(200_000_000n, 2000);
  const o2 = (await (program.account as any).order.fetch(p2.pda)) as OrderAccount;
  const refused = await sendLanding((await buildExecuteIx({ program, connection: conn, orderPda: p2.pda, order: o2, amountIn: new BN(100_000_000), keeper: keeper.publicKey, cluster: "devnet" })).ix);
  record("priceRejected", refused.sig, `failed on chain: ${refused.err}`, "a 2,000 USDC per token order; the pool pays about 930, so the program refuses the swap");
  await sendAndConfirmTransaction(conn, new Transaction().add(await program.methods.cancelOrder().accountsStrict({ owner: holder.publicKey, order: p2.pda }).instruction()), [holder], { commitment: "confirmed" });

  // ---------- 2. Arm for IPO on the demo token ----------
  const demo = (cfg.demo ?? {}) as Demo;
  cfg.demo = demo;
  if (!demo.mint) {
    demo.mint = (await createReplicaMint(conn, issuer, { label: "demo PreStock", decimals: 9, multiplier: 1, transferFeeBps: 100, name: "Demo PreStock (simulated, devnet)", symbol: "DEMO", uri: "https://holdfill.midelabs.xyz/demo" })).toBase58();
    writeConfig(cfg);
  }
  if (!demo.successor) {
    demo.successor = (await createReplicaMint(conn, issuer, { label: "demo successor", decimals: 8, multiplier: 1, transferFeeBps: 0, name: "Demo successor (simulated, devnet)", symbol: "DEMOx", uri: "https://holdfill.midelabs.xyz/demo" })).toBase58();
    writeConfig(cfg);
  }
  const DEMO = new PublicKey(demo.mint), DEMOX = new PublicKey(demo.successor);
  await mintInventory(conn, issuer, DEMO, 500n * 10n ** 9n);
  await mintInventory(conn, issuer, DEMOX, 5_000n * 10n ** 8n);
  if (!demo.pool) {
    // Entitlement 1 DEMOx per DEMO (base units 1e9 -> 1e8). The pool mid sits 15% under it.
    demo.pool = (await createPair(conn, issuer, DEMO, DEMOX, 0.085)).pair.toBase58();
    writeConfig(cfg);
  }
  if (!demo.positions?.length) {
    demo.positions = await seedLiquidity(conn, issuer, new PublicKey(demo.pool), 0.05, 100n * 10n ** 9n, 1_000n * 10n ** 8n);
    writeConfig(cfg);
  }
  if (await conn.getAccountInfo(eventFor(DEMO))) throw new Error("the demo event already exists; this proof records the arm-then-event order only once");

  await sendAndConfirmTransaction(conn, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(holder.publicKey, ata2022(holder.publicKey, DEMO), holder.publicKey, DEMO, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(holder.publicKey, ata2022(holder.publicKey, DEMOX), holder.publicKey, DEMOX, TOKEN_2022_PROGRAM_ID),
  ), [holder]);
  await mintTo(conn, issuer, DEMO, ata2022(holder.publicKey, DEMO), issuer, 1_000_000_000n, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  const armed = orderFor(holder.publicKey, DEMO);
  const armIx = await program.methods
    .armOrder({ size: new BN(500_000_000), limitBps: 3000, fallbackDaysBefore: 30, fallbackFloorBps: 5000 })
    .accountsStrict({ owner: holder.publicKey, inputMint: DEMO, event: eventFor(DEMO), ownerTokenIn: ata2022(holder.publicKey, DEMO), order: armed, systemProgram: SystemProgram.programId })
    .instruction();
  const approve = createApproveCheckedInstruction(ata2022(holder.publicKey, DEMO), DEMO, armed, holder.publicKey, 500_000_000n, 9, [], TOKEN_2022_PROGRAM_ID);
  record("armed", await sendAndConfirmTransaction(conn, new Transaction().add(armIx, approve), [holder], { commitment: "confirmed" }), "confirmed",
    "0.5 demo token armed before any issuer event: largest gap 30%, fallback 30 days before the deadline at 50%");
  await sleep(800);
  const [idle] = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: armed });
  if (idle) throw new Error(`keeper acted on an armed order with no event: ${idle.action}`);

  const eventSig = await program.methods
    .registerEvent({ outputMint: DEMOX, pool: new PublicKey(demo.pool), ratioNum: new BN(1), ratioDen: new BN(10), expiryTs: new BN(EXPIRY) })
    .accountsStrict({ admin: issuer.publicKey, inputMint: DEMO, event: eventFor(DEMO), systemProgram: SystemProgram.programId })
    .rpc();
  demo.event = eventFor(DEMO).toBase58();
  writeConfig(cfg);
  record("simulatedEvent", eventSig, "confirmed", "SIMULATED issuer event for the demo token: 1 DEMOx per token, deadline 2027-03-12T23:59Z");
  await sleep(1500);

  const [act] = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: armed });
  if (act?.action !== "activated" || !act.signature) throw new Error(`activation failed: ${act?.action} ${act?.reason}`);
  record("activated", act.signature, "confirmed", "keeper copied the event terms into the armed order; the holder's 30% limit is unchanged");
  await sleep(1500);
  // Right after activation a quote can fail simulation once; the keeper simply tries again next tick.
  let armedFill: Awaited<ReturnType<typeof tick>>[number] | undefined;
  for (let i = 0; i < 3 && armedFill?.action !== "filled"; i++) {
    if (i) await sleep(4000);
    [armedFill] = await tick({ connection: conn, program, keeper, cluster: "devnet", onlyOrder: armed });
  }
  if (armedFill?.action !== "filled" || !armedFill.signature) throw new Error(`armed order did not fill: ${armedFill?.action} ${armedFill?.reason}`);
  const gap = 1 - Number(armedFill.quotedOut) / 1e8 / (Number(armedFill.amountIn) / 1e9);
  record("armedFilled", armedFill.signature, "confirmed", `keeper sold ${Number(armedFill.amountIn) / 1e9} demo token for about ${(Number(armedFill.quotedOut) / 1e8).toFixed(4)} DEMOx, ${(gap * 100).toFixed(1)}% under entitlement, limit 30%`);

  fs.writeFileSync(path.join(ROOT, "data/proof-devnet-v2.json"), JSON.stringify({
    ranAt: new Date().toISOString(), network: "devnet", programId: program.programId.toBase58(),
    priceMarket: { symbol: "ANTHROPIC", mint: ANTH.toBase58(), usdc: USDC.toBase58(), pool: APOOL.toBase58() },
    demo: { note: "Demo token and simulated issuer event, devnet only. No real issuer announced this event.", ...demo },
    transactions: proof,
  }, null, 2) + "\n");
  console.log("\nPASS  v2 devnet proof recorded");
}
main().catch((e) => { console.error("PROOF FAILED:", e?.message ?? e, (e?.logs ?? []).slice(-5).join("\n")); process.exit(2); });
