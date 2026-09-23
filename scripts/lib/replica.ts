// Replica Token-2022 mints for devnet markets. Shared by setup-devnet.ts and setup-markets.ts.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  ExtensionType, TOKEN_2022_PROGRAM_ID, createInitializeMetadataPointerInstruction,
  createInitializeMint2Instruction, createInitializePausableConfigInstruction,
  createInitializePermanentDelegateInstruction, createInitializeScaledUiAmountConfigInstruction,
  createInitializeTransferFeeConfigInstruction, getMintLen, getOrCreateAssociatedTokenAccount,
  mintTo, tokenMetadataInitializeWithRentTransfer,
} from "@solana/spl-token";

export type MintSpec = {
  label: string; decimals: number; multiplier: number; transferFeeBps: number;
  name: string; symbol: string; uri: string;
};

// Gate G1 result (23 Sep 2026, scripts/probe-dlmm-extensions.ts): Meteora DLMM on devnet accepts
// TransferFeeConfig and MetadataPointer, but rejects ScaledUiAmount (UnsupportedMintExtension, 6070)
// and PermanentDelegate, Pausable, or a freeze authority (UnsupportedTokenMint, 6073) unless the admin issues a token badge.
// Mainnet SPACEX has that badge. Replicas keep the 1% transfer fee, which drives Holdfill's behavior;
// the 5x split is applied by the app from the issuer-stated ratio, and the order program works in raw units.
export const BADGE_GATED = process.env.REPLICA_BADGE_GATED === "1";

export async function createReplicaMint(conn: Connection, issuer: Keypair, spec: MintSpec): Promise<PublicKey> {
  const mint = Keypair.generate();
  const extensions = [
    ...(spec.transferFeeBps > 0 ? [ExtensionType.TransferFeeConfig] : []),
    ...(BADGE_GATED ? [ExtensionType.ScaledUiAmountConfig, ExtensionType.PermanentDelegate, ExtensionType.PausableConfig] : []),
    ExtensionType.MetadataPointer,
  ];
  const space = getMintLen(extensions);
  const lamports = await conn.getMinimumBalanceForRentExemption(space);
  const auth = issuer.publicKey;
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: auth, newAccountPubkey: mint.publicKey, space, lamports, programId: TOKEN_2022_PROGRAM_ID,
    }),
    ...(spec.transferFeeBps > 0
      ? [createInitializeTransferFeeConfigInstruction(mint.publicKey, auth, auth, spec.transferFeeBps, BigInt("18446744073709551615"), TOKEN_2022_PROGRAM_ID)]
      : []),
    ...(BADGE_GATED
      ? [createInitializeScaledUiAmountConfigInstruction(mint.publicKey, auth, spec.multiplier, TOKEN_2022_PROGRAM_ID),
         createInitializePermanentDelegateInstruction(mint.publicKey, auth, TOKEN_2022_PROGRAM_ID),
         createInitializePausableConfigInstruction(mint.publicKey, auth, TOKEN_2022_PROGRAM_ID)]
      : []),
    createInitializeMetadataPointerInstruction(mint.publicKey, auth, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    // No freeze authority: DLMM rejects freezable mints without a badge (UnsupportedTokenMint, 6073).
    createInitializeMint2Instruction(mint.publicKey, spec.decimals, auth, BADGE_GATED ? auth : null, TOKEN_2022_PROGRAM_ID),
  );
  await sendAndConfirmTransaction(conn, tx, [issuer, mint], { commitment: "confirmed" });
  await tokenMetadataInitializeWithRentTransfer(
    conn, issuer, mint.publicKey, auth, issuer, spec.name, spec.symbol, spec.uri, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID,
  );
  console.log(`created ${spec.label}: ${mint.publicKey.toBase58()}`);
  return mint.publicKey;
}

/** Tops up the issuer's inventory of `mint`. `authority` is the mint authority (the issuer unless given). */
export async function mintInventory(conn: Connection, issuer: Keypair, mint: PublicKey, amount: bigint, authority: Keypair = issuer) {
  const ata = await getOrCreateAssociatedTokenAccount(conn, issuer, mint, issuer.publicKey, false, "confirmed", undefined, TOKEN_2022_PROGRAM_ID);
  if (ata.amount >= amount) return ata.address;
  await mintTo(conn, issuer, mint, ata.address, authority, amount - ata.amount, [], { commitment: "confirmed" }, TOKEN_2022_PROGRAM_ID);
  return ata.address;
}

