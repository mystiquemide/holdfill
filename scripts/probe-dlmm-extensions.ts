// Gate G1 probe: which Token-2022 extensions does Meteora DLMM on devnet accept without a token badge?
// Creates one test mint per extension set and simulates initialize_lb_pair2 against a plain mint.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  ExtensionType, TOKEN_2022_PROGRAM_ID, createInitializeMetadataPointerInstruction, createInitializeMint2Instruction,
  createInitializeScaledUiAmountConfigInstruction, createInitializeTransferFeeConfigInstruction, getMintLen,
} from "@solana/spl-token";
import BN from "bn.js";
import DLMM from "@meteora-ag/dlmm";
import { devnet, issuerKeypair } from "./lib/env";

type Ext = "fee" | "scaled" | "pointer";

async function mint(conn: Connection, payer: Keypair, exts: Ext[], decimals: number): Promise<PublicKey> {
  const m = Keypair.generate();
  const types = exts.map((e) => ({ fee: ExtensionType.TransferFeeConfig, scaled: ExtensionType.ScaledUiAmountConfig, pointer: ExtensionType.MetadataPointer }[e]));
  const space = getMintLen(types);
  const ix = [SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: m.publicKey, space, lamports: await conn.getMinimumBalanceForRentExemption(space), programId: TOKEN_2022_PROGRAM_ID })];
  if (exts.includes("fee")) ix.push(createInitializeTransferFeeConfigInstruction(m.publicKey, payer.publicKey, payer.publicKey, 100, BigInt("18446744073709551615"), TOKEN_2022_PROGRAM_ID));
  if (exts.includes("scaled")) ix.push(createInitializeScaledUiAmountConfigInstruction(m.publicKey, payer.publicKey, 5, TOKEN_2022_PROGRAM_ID));
  if (exts.includes("pointer")) ix.push(createInitializeMetadataPointerInstruction(m.publicKey, payer.publicKey, m.publicKey, TOKEN_2022_PROGRAM_ID));
  ix.push(createInitializeMint2Instruction(m.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID));
  await sendAndConfirmTransaction(conn, new Transaction().add(...ix), [payer, m], { commitment: "confirmed" });
  return m.publicKey;
}

async function main() {
  const conn = devnet();
  const payer = issuerKeypair();
  const presets = await DLMM.getAllPresetParameters(conn);
  const preset = presets.presetParameter2.find((p) => p.account.binStep === 10)!.publicKey;
  const plainY = await mint(conn, payer, [], 8);
  const cases: Ext[][] = [[], ["fee"], ["scaled"], ["pointer"], ["fee", "pointer"]];
  for (const exts of cases) {
    const x = await mint(conn, payer, exts, 9);
    const tx = await DLMM.createLbPair2(conn, payer.publicKey, x, plainY, preset, new BN(-976), { cluster: "devnet" });
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const sim = await conn.simulateTransaction(tx);
    const err = sim.value.err ? (sim.value.logs ?? []).find((l) => l.includes("Error Code")) ?? JSON.stringify(sim.value.err) : null;
    console.log(`extensions [${exts.join(", ") || "none"}]: ${err ? "REJECTED " + err.replace(/.*Error Code: /, "") : "ACCEPTED"}`);
  }
}
main().catch((e) => { console.error("PROBE FAILED:", e?.message ?? e); process.exit(1); });
