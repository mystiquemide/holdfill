// npm run proof:fork
// Runs holdfill_orders against cloned mainnet state: the real SpaceX PreStocks mint (every
// Token-2022 extension, the live 1% transfer fee), the real SPCXx mint, and the real Meteora DLMM
// pool. Starts a local validator, runs five checks with the order PDA as the holder's delegate,
// stops the validator, and writes data/proof-fork.json. Needs HELIUS_API_KEY and
// solana-test-validator on PATH, plus a built program (npm run build:program).
//
// What is not cloned as-is, and why:
// - The holder's SPACEX account is injected with 1 raw token (5 shares). It copies the pool's real
//   SPACEX reserve account, so it carries the same account extensions, re-owned to a local holder.
// - The lifecycle event (issuer terms: SPCXx, 5 shares per token, 12 Mar 2027) is written into
//   genesis, so the run needs no admin key.
// - The mint's pause and fee authorities point at a local key, so the run can act as the issuer
//   through the real Token-2022 program. Every other mint byte is mainnet.
// - Epochs are 32 slots and the ledger starts at mainnet's current epoch, so the fee in force
//   matches mainnet and a fee change lands in about 30 seconds.
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, calculateEpochFee, createApproveCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction, createPauseInstruction, createResumeInstruction,
  createRevokeInstruction, createSetTransferFeeInstruction, getAccount, getAssociatedTokenAddressSync,
  getMint, getTransferFeeAmount, getTransferFeeConfig,
} from "@solana/spl-token";
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import DLMM, { binIdToBinArrayIndex, deriveBinArray, deriveBinArrayBitmapExtension } from "@meteora-ag/dlmm";
import { buildExecuteIx, type OrderAccount } from "../keeper/execute-ix";
import { requiredOutput } from "../keeper/math";
import { DLMM_PROGRAM_ID, MAINNET, ROOT, devnet, mainnet } from "./lib/env";

const RPC_PORT = 8999;
const LOCAL = `http://127.0.0.1:${RPC_PORT}`;
const SLOTS_PER_EPOCH = 32;
const EXPIRY = Math.floor(Date.parse("2027-03-12T23:59:00Z") / 1000);
const FALLBACK = Math.floor(Date.parse("2027-03-01T00:00:00Z") / 1000);
const HOLDER_RAW = 1_000_000_000n; // 1 raw SPACEX = 5 shares
const FILL = new BN(100_000_000); // 0.1 raw per fill
const SO = path.join(ROOT, "target/deploy/holdfill_orders.so");
const OUT = path.join(ROOT, "data/proof-fork.json");
const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "idl/holdfill_orders.json"), "utf8"));
const PROGRAM_ID = new PublicKey(idl.address);

const EXT_TRANSFER_FEE_CONFIG = 1;
const EXT_TRANSFER_FEE_AMOUNT = 2;
const EXT_TRANSFER_HOOK = 14;
const EXT_PAUSABLE_CONFIG = 26;

type Check = { name: string; pass: boolean; expected: string; result: string; detail: string; signature?: string };

/** Token-2022 TLV entries after the 165-byte base and the account-type byte: [type, valueOffset, length]. */
function extensions(data: Buffer): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let o = 166; o + 4 <= data.length;) {
    const type = data.readUInt16LE(o), len = data.readUInt16LE(o + 2);
    if (type === 0 && len === 0) break;
    out.push([type, o + 4, len]);
    o += 4 + len;
  }
  return out;
}

function extension(data: Buffer, type: number): number {
  const e = extensions(data).find(([t]) => t === type);
  if (!e) throw new Error(`extension ${type} not found`);
  return e[1];
}

const accountFile = (dir: string, pubkey: PublicKey, lamports: number, owner: PublicKey, data: Buffer) => {
  const file = path.join(dir, `${pubkey.toBase58()}.json`);
  fs.writeFileSync(file, JSON.stringify({
    pubkey: pubkey.toBase58(),
    account: { lamports, data: [data.toString("base64"), "base64"], owner: owner.toBase58(), executable: false, rentEpoch: 0, space: data.length },
  }));
  return file;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when the devnet deployment of the program is byte-identical to the local binary. */
async function matchesDevnet(so: Buffer): Promise<boolean> {
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], loader);
  const info = await devnet().getAccountInfo(programData);
  if (!info) return false;
  const elf = info.data.subarray(45); // UpgradeableLoaderState::ProgramData header
  return elf.subarray(0, so.length).equals(so) && elf.subarray(so.length).every((b) => b === 0);
}

function errorName(logs: string[], err: unknown): string {
  const anchor = logs.find((l) => l.includes("Error Code:"));
  if (anchor) return anchor.replace(/.*Error Code: (\w+).*/, "$1");
  const failed = logs.find((l) => /failed: /.test(l));
  return failed ? failed.replace(/.*failed: /, "") : JSON.stringify(err);
}

async function main() {
  if (!fs.existsSync(SO)) throw new Error("target/deploy/holdfill_orders.so is missing. Run npm run build:program first.");
  const mn = mainnet();
  const local = new Connection(LOCAL, "confirmed");
  if (await local.getSlot().then(() => true, () => false)) throw new Error(`port ${RPC_PORT} is already serving a validator; stop it first`);

  // 1. Read mainnet: pool, mints, reserves, bin arrays, epoch.
  const pool = await DLMM.create(mn, MAINNET.pool, { cluster: "mainnet-beta" as never });
  if (!pool.lbPair.tokenXMint.equals(MAINNET.spacex) || !pool.lbPair.tokenYMint.equals(MAINNET.spcxx)) throw new Error("pool mints changed");
  const [epochInfo, mintInfo, reserveInfo] = await Promise.all([
    mn.getEpochInfo(), mn.getAccountInfo(MAINNET.spacex), mn.getAccountInfo(pool.lbPair.reserveX),
  ]);
  if (!mintInfo || !reserveInfo) throw new Error("mainnet accounts not found");
  const mainnetSlot = epochInfo.absoluteSlot;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "holdfill-fork-"));
  const issuerStandIn = Keypair.generate();
  const holder = Keypair.generate();
  const keeper = Keypair.generate();
  const ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
  const holderIn = ata(holder.publicKey, MAINNET.spacex);
  const holderOut = ata(holder.publicKey, MAINNET.spcxx);

  // Mint: hand the pause and fee authorities to the local issuer stand-in.
  const mintData = Buffer.from(mintInfo.data);
  const realFeeAuthority = new PublicKey(mintData.subarray(extension(mintData, EXT_TRANSFER_FEE_CONFIG), extension(mintData, EXT_TRANSFER_FEE_CONFIG) + 32));
  issuerStandIn.publicKey.toBuffer().copy(mintData, extension(mintData, EXT_TRANSFER_FEE_CONFIG));
  issuerStandIn.publicKey.toBuffer().copy(mintData, extension(mintData, EXT_PAUSABLE_CONFIG));
  const hookOffset = extensions(mintData).find(([t]) => t === EXT_TRANSFER_HOOK)?.[1];
  const hookProgram = hookOffset === undefined ? PublicKey.default : new PublicKey(mintData.subarray(hookOffset + 32, hookOffset + 64));

  // Holder's SPACEX account: the pool's real reserve account, re-owned, 1 raw, nothing withheld.
  const holderData = Buffer.from(reserveInfo.data);
  holder.publicKey.toBuffer().copy(holderData, 32);
  holderData.writeBigUInt64LE(HOLDER_RAW, 64);
  holderData.writeBigUInt64LE(0n, extension(holderData, EXT_TRANSFER_FEE_AMOUNT));

  // Lifecycle event: the issuer's published terms.
  const coderProgram = new Program(idl, new AnchorProvider(local, new Wallet(keeper), { commitment: "confirmed" }));
  const [eventPda, eventBump] = PublicKey.findProgramAddressSync([Buffer.from("event"), MAINNET.spacex.toBuffer()], PROGRAM_ID);
  const eventData = await coderProgram.coder.accounts.encode("lifecycleEvent", {
    inputMint: MAINNET.spacex, outputMint: MAINNET.spcxx, pool: MAINNET.pool,
    ratioNum: new BN(1), ratioDen: new BN(2), expiryTs: new BN(EXPIRY), bump: eventBump,
  });

  const activeIndex = binIdToBinArrayIndex(new BN(pool.lbPair.activeId)).toNumber();
  const binArrays = [];
  for (let i = activeIndex - 3; i <= activeIndex + 1; i++) binArrays.push(deriveBinArray(MAINNET.pool, new BN(i), DLMM_PROGRAM_ID)[0]);
  const cloned = [
    MAINNET.spcxx, MAINNET.pool, pool.lbPair.reserveX, pool.lbPair.reserveY, pool.lbPair.oracle,
    deriveBinArrayBitmapExtension(MAINNET.pool, DLMM_PROGRAM_ID)[0], ...binArrays,
  ];
  const programs = [DLMM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ...(hookProgram.equals(PublicKey.default) ? [] : [hookProgram])];

  const args = [
    "--reset", "--quiet", "--ledger", path.join(dir, "ledger"),
    "--rpc-port", String(RPC_PORT), "--faucet-port", String(RPC_PORT + 910),
    "--url", `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
    "--slots-per-epoch", String(SLOTS_PER_EPOCH), "--warp-slot", String(epochInfo.epoch * SLOTS_PER_EPOCH),
    ...programs.flatMap((p) => ["--clone-upgradeable-program", p.toBase58()]),
    "--bpf-program", PROGRAM_ID.toBase58(), SO,
    "--account", MAINNET.spacex.toBase58(), accountFile(dir, MAINNET.spacex, mintInfo.lamports, TOKEN_2022_PROGRAM_ID, mintData),
    "--account", holderIn.toBase58(), accountFile(dir, holderIn, reserveInfo.lamports, TOKEN_2022_PROGRAM_ID, holderData),
    "--account", eventPda.toBase58(), accountFile(dir, eventPda, await mn.getMinimumBalanceForRentExemption(eventData.length), PROGRAM_ID, eventData),
    ...cloned.flatMap((a) => ["--maybe-clone", a.toBase58()]),
  ];

  console.log("Holdfill fork proof");
  console.log(`  mainnet slot ${mainnetSlot}, epoch ${epochInfo.epoch}`);
  console.log(`  SPACEX mint ${MAINNET.spacex.toBase58()}`);
  console.log(`  SPCXx mint  ${MAINNET.spcxx.toBase58()}`);
  console.log(`  DLMM pool   ${MAINNET.pool.toBase58()}`);
  console.log(`  program     ${PROGRAM_ID.toBase58()}`);
  console.log("  starting local validator with cloned mainnet state...");

  // 2. Start the validator and wait for it.
  const validator: ChildProcess = spawn("solana-test-validator", args, { stdio: ["ignore", "ignore", "pipe"] });
  let validatorErr = "";
  validator.stderr?.on("data", (d) => (validatorErr += d));
  const stop = () => { if (validator.exitCode === null) validator.kill("SIGTERM"); };
  process.on("exit", stop);
  process.on("SIGINT", () => { stop(); process.exit(130); });
  validator.on("error", (e) => { console.error(`cannot start solana-test-validator: ${e.message}`); process.exit(2); });

  try {
    const deadline = Date.now() + 180_000;
    for (;;) {
      if (validator.exitCode !== null) throw new Error(`validator exited: ${validatorErr.trim() || "see ledger log"} (${path.join(dir, "ledger/validator.log")})`);
      if (await local.getSlot().then((s) => s > 0, () => false)) break;
      if (Date.now() > deadline) throw new Error("validator did not start within 180 s");
      await sleep(1000);
    }
    const results = await runChecks({ local, holder, keeper, issuerStandIn, holderIn, holderOut, eventPda, reserveX: pool.lbPair.reserveX });

    const passed = results.checks.filter((c) => c.pass).length;
    console.log(`\n${passed} of ${results.checks.length} PASS`);
    const proof = {
      command: "npm run proof:fork",
      ranAt: new Date().toISOString(),
      network: "local validator cloned from mainnet",
      mainnet: { slot: mainnetSlot, epoch: epochInfo.epoch, rpc: "Helius mainnet" },
      localChainTime: results.chainTime,
      validator: "solana-test-validator",
      program: {
        id: PROGRAM_ID.toBase58(),
        binarySha256: crypto.createHash("sha256").update(fs.readFileSync(SO)).digest("hex"),
        sameBinaryAsDevnetDeployment: await matchesDevnet(fs.readFileSync(SO)),
      },
      mints: { spacex: MAINNET.spacex.toBase58(), spcxx: MAINNET.spcxx.toBase58() },
      pool: MAINNET.pool.toBase58(),
      clonedPrograms: programs.map((p) => p.toBase58()),
      clonedAccounts: cloned.map((a) => a.toBase58()),
      substitutions: [
        `Holder SPACEX account ${holderIn.toBase58()}: copy of the pool's SPACEX reserve account (same extensions), owner set to a local holder, 1 raw SPACEX, withheld fee zeroed.`,
        `Lifecycle event ${eventPda.toBase58()}: issuer terms (SPCXx, 5 shares per token, deadline 2027-03-12T23:59Z) written into genesis.`,
        `SPACEX mint: transfer fee and pause authorities changed from ${realFeeAuthority.toBase58()} to a local key so the run can act as the issuer. All other mint bytes are mainnet.`,
        `Epochs are ${SLOTS_PER_EPOCH} slots and the ledger starts at mainnet epoch ${epochInfo.epoch}, so the transfer fee in force matches mainnet.`,
      ],
      fill: results.fill,
      checks: results.checks,
      passed,
      total: results.checks.length,
    };
    fs.writeFileSync(OUT, JSON.stringify(proof, null, 2) + "\n");
    console.log(`program binary matches the devnet deployment: ${proof.program.sameBinaryAsDevnetDeployment ? "yes" : "no"}`);
    console.log(`wrote ${path.relative(ROOT, OUT)}`);
    stop();
    await new Promise((r) => (validator.exitCode === null ? validator.once("exit", r) : r(null)));
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(passed === results.checks.length ? 0 : 1);
  } catch (e) {
    stop();
    throw e;
  }
}

async function runChecks(p: {
  local: Connection; holder: Keypair; keeper: Keypair; issuerStandIn: Keypair;
  holderIn: PublicKey; holderOut: PublicKey; eventPda: PublicKey; reserveX: PublicKey;
}) {
  const { local, holder, keeper, issuerStandIn, holderIn, holderOut, eventPda } = p;
  const program = new Program(idl, new AnchorProvider(local, new Wallet(keeper), { commitment: "confirmed" }));
  const orderPda = PublicKey.findProgramAddressSync([Buffer.from("order"), holder.publicKey.toBuffer(), MAINNET.spacex.toBuffer()], PROGRAM_ID)[0];
  const checks: Check[] = [];

  // Sends without preflight so a rejected fill is a failed transaction on the ledger, not a simulation.
  async function send(ixs: TransactionInstruction[], signers: Keypair[]) {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = signers[0].publicKey;
    const { blockhash, lastValidBlockHeight } = await local.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.sign(...signers);
    const sig = await local.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    // web3.js rejects with the raw transaction error when the failed status is already visible,
    // and resolves otherwise. Either way the transaction landed; the ledger has the result.
    const confirmError = await local.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed").then(() => null, (e) => e);
    const t = await local.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!t && confirmError) throw confirmError;
    const logs = t?.meta?.logMessages ?? [];
    return { sig, err: t?.meta?.err ?? null, logs };
  }
  async function mustSend(ixs: TransactionInstruction[], signers: Keypair[], what: string) {
    const r = await send(ixs, signers);
    if (r.err) throw new Error(`${what} failed: ${errorName(r.logs, r.err)}`);
    return r;
  }
  const executeIx = async () => {
    const order = (await (program.account as any).order.fetch(orderPda)) as OrderAccount;
    return (await buildExecuteIx({ program, connection: local, orderPda, order, amountIn: FILL, keeper: keeper.publicKey, cluster: "mainnet-beta" })).ix;
  };
  async function createOrder(limitBps: number, size: bigint) {
    const ix = await program.methods
      .createOrder({ size: new BN(size.toString()), limitBps, fallbackTs: new BN(FALLBACK), fallbackFloorBps: 5000 })
      .accountsStrict({ owner: holder.publicKey, event: eventPda, inputMint: MAINNET.spacex, ownerTokenIn: holderIn, order: orderPda, systemProgram: SystemProgram.programId })
      .instruction();
    await mustSend([ix, createApproveCheckedInstruction(holderIn, MAINNET.spacex, orderPda, holder.publicKey, size, 9, [], TOKEN_2022_PROGRAM_ID)], [holder], "create order");
  }
  async function cancelOrder() {
    const ix = await program.methods.cancelOrder().accountsStrict({ owner: holder.publicKey, order: orderPda }).instruction();
    await mustSend([ix, createRevokeInstruction(holderIn, holder.publicKey, [], TOKEN_2022_PROGRAM_ID)], [holder], "cancel order");
  }
  async function expectRejected(name: string, expected: string[], detail: string, prebuilt?: TransactionInstruction) {
    const r = await send([prebuilt ?? (await executeIx())], [keeper]);
    const code = r.err ? errorName(r.logs, r.err) : "confirmed";
    const pass = r.err !== null && expected.some((x) => code.includes(x));
    checks.push({ name, pass, expected: `rejected with ${expected.join(" or ")}`, result: r.err ? `failed on chain: ${code}` : "confirmed", detail, signature: r.sig });
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${r.err ? `rejected with ${code}` : "transaction succeeded"}`);
  }
  const balance = async (a: PublicKey) => (await getAccount(local, a, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  const epoch = async () => BigInt((await local.getEpochInfo("confirmed")).epoch);

  for (const k of [holder, keeper, issuerStandIn]) {
    await local.confirmTransaction(await local.requestAirdrop(k.publicKey, 2 * LAMPORTS_PER_SOL), "confirmed");
  }
  const chainTime = new Date(((await local.getBlockTime(await local.getSlot("confirmed"))) ?? 0) * 1000).toISOString();
  await mustSend([createAssociatedTokenAccountIdempotentInstruction(holder.publicKey, holderOut, holder.publicKey, MAINNET.spcxx, TOKEN_2022_PROGRAM_ID)], [holder], "create SPCXx account");

  const feeConfig = getTransferFeeConfig(await getMint(local, MAINNET.spacex, "confirmed", TOKEN_2022_PROGRAM_ID))!;
  const feeNow = await epoch();
  const feeBps = feeConfig.newerTransferFee.epoch <= feeNow ? feeConfig.newerTransferFee.transferFeeBasisPoints : feeConfig.olderTransferFee.transferFeeBasisPoints;
  console.log(`  local epoch ${feeNow}, SPACEX transfer fee in force ${feeBps} bps, chain time ${chainTime}\n`);

  // Check 1: a fill that meets the holder's minimum, with the order PDA signing swap2 as delegate.
  const limitBps = 4000;
  await createOrder(limitBps, 500_000_000n);
  const inBefore = await balance(holderIn), outBefore = await balance(holderOut);
  const withheldBefore = getTransferFeeAmount(await getAccount(local, p.reserveX, "confirmed", TOKEN_2022_PROGRAM_ID))?.withheldAmount ?? 0n;
  const fill = await send([await executeIx()], [keeper]);
  const spent = inBefore - (await balance(holderIn));
  const received = (await balance(holderOut)) - outBefore;
  const withheld = (getTransferFeeAmount(await getAccount(local, p.reserveX, "confirmed", TOKEN_2022_PROGRAM_ID))?.withheldAmount ?? 0n) - withheldBefore;
  const expectedFee = calculateEpochFee(feeConfig, feeNow, BigInt(FILL.toString()));
  const required = requiredOutput(BigInt(FILL.toString()), 1n, 2n, BigInt(limitBps));
  const entitlement = BigInt(FILL.toString()) / 2n;
  const keeperTokens = (await local.getTokenAccountsByOwner(keeper.publicKey, { programId: TOKEN_2022_PROGRAM_ID })).value.length;
  const gapPct = Number((1 - Number(received) / Number(entitlement)) * 100);
  const cpi = fill.logs.filter((l) => / invoke \[\d\]$/.test(l) || /Instruction: /.test(l));
  const fillPass = !fill.err && spent === BigInt(FILL.toString()) && received >= required && withheld === expectedFee && keeperTokens === 0;
  checks.push({
    name: "Fill at the holder's price on the real pool",
    pass: fillPass,
    expected: `holder spends 0.1 raw SPACEX, receives at least ${Number(required) / 1e8} SPCXx (40% limit), the mint withholds its fee, keeper holds no tokens`,
    result: fill.err ? `failed: ${errorName(fill.logs, fill.err)}` : "confirmed",
    detail: `order PDA signed DLMM swap2 through CPI as delegate. Holder spent ${Number(spent) / 1e9} raw SPACEX, received ${Number(received) / 1e8} SPCXx (entitlement ${Number(entitlement) / 1e8}, ${gapPct.toFixed(1)}% under, fees included). Transfer fee withheld ${withheld} base units (${feeBps} bps). Keeper token accounts: ${keeperTokens}.`,
    signature: fill.sig,
  });
  console.log(`${fillPass ? "PASS" : "FAIL"}  ${checks[0].name}: ${checks[0].detail}`);

  // Check 2: the issuer pauses the mint through the real Token-2022 program. The fill is built first:
  // the DLMM SDK simulates the swap while building, and that simulation would hit the pause.
  const beforePause = await executeIx();
  await mustSend([createPauseInstruction(MAINNET.spacex, issuerStandIn.publicKey, [], TOKEN_2022_PROGRAM_ID)], [issuerStandIn], "pause");
  await expectRejected("Issuer pause blocks the fill", ["MintPaused"], "the issuer paused SPACEX; the program refuses before any tokens move", beforePause);
  await mustSend([createResumeInstruction(MAINNET.spacex, issuerStandIn.publicKey, [], TOKEN_2022_PROGRAM_ID)], [issuerStandIn], "resume");

  // Check 3: the holder revokes the approval; the order account still exists.
  await mustSend([createRevokeInstruction(holderIn, holder.publicKey, [], TOKEN_2022_PROGRAM_ID)], [holder], "revoke");
  await expectRejected("Revoke stops fills at once", ["DelegateMismatch"], "the holder revoked the token approval; the order account still exists but cannot move tokens");
  await cancelOrder();

  // Check 4: a 10% limit the pool cannot pay.
  await createOrder(1000, 400_000_000n);
  const required10 = requiredOutput(BigInt(FILL.toString()), 1n, 2n, 1000n);
  await expectRejected("Fill below the holder's minimum is rejected", ["ExceededAmountSlippageTolerance", "InsufficientOutput"],
    `10% limit needs at least ${Number(required10) / 1e8} SPCXx for 0.1 raw; the pool pays about ${Number(received) / 1e8}`);
  await cancelOrder();

  // Check 5: the issuer raises the transfer fee after the order was signed. Token-2022 applies it two epochs later.
  await createOrder(limitBps, 400_000_000n);
  const newFee = feeBps + 100;
  await mustSend([createSetTransferFeeInstruction(MAINNET.spacex, issuerStandIn.publicKey, [], newFee, feeConfig.newerTransferFee.maximumFee, TOKEN_2022_PROGRAM_ID)], [issuerStandIn], "set transfer fee");
  const effective = getTransferFeeConfig(await getMint(local, MAINNET.spacex, "confirmed", TOKEN_2022_PROGRAM_ID))!.newerTransferFee.epoch;
  console.log(`  issuer set the fee to ${newFee} bps, effective epoch ${effective}; waiting...`);
  while ((await epoch()) < effective) await sleep(1000);
  await expectRejected("Issuer fee change blocks the fill", ["FeeChanged"], `order signed at ${feeBps} bps; the issuer raised the fee to ${newFee} bps; the holder must re-sign with the new fee in view`);

  return {
    chainTime,
    checks,
    fill: {
      signature: fill.sig,
      amountInRaw: FILL.toString(),
      receivedSpcxxBase: received.toString(),
      requiredSpcxxBase: required.toString(),
      entitlementSpcxxBase: entitlement.toString(),
      gapPct: Number(gapPct.toFixed(2)),
      transferFeeBps: feeBps,
      feeWithheldBase: withheld.toString(),
      programLogs: cpi,
    },
  };
}

main().catch((e) => { console.error("FORK PROOF ERROR", e?.message ?? e); process.exit(2); });
