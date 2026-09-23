// Builds a holdfill_orders `execute` instruction for an order. Meteora's SDK produces the exact
// swap2 account list (bin arrays, hook slices); those accounts are passed through to our program,
// which re-derives and checks everything it can before signing the swap as the holder's delegate.
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BN, Program } from "@anchor-lang/core";
import DLMM from "@meteora-ag/dlmm";

export const DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

// swap2 account order from the DLMM IDL. Indexes into the SDK instruction's keys.
const SWAP2_FIXED = [
  "lbPair", "binArrayBitmapExtension", "reserveX", "reserveY", "userTokenIn", "userTokenOut",
  "tokenXMint", "tokenYMint", "oracle", "hostFeeIn", "user", "tokenXProgram", "tokenYProgram",
  "memoProgram", "eventAuthority", "dlmmProgram",
] as const;

export type OrderAccount = {
  owner: PublicKey; inputMint: PublicKey; outputMint: PublicKey; pool: PublicKey;
  ratioNum: BN; ratioDen: BN; limitBps: number; fallbackTs: BN; fallbackFloorBps: number;
  expiryTs: BN; feeBps: number; size: BN; filled: BN; received: BN;
};

type Slice = { accountsType: Record<string, unknown>; length: number };

const ACCOUNTS_TYPES = ["transferHookX", "transferHookY", "transferHookReward", "transferHookMultiReward", "transferHookReferral"];

/** Decodes swap2's trailing RemainingAccountsInfo (Borsh: u32 count, then {enum, u8}). */
export function decodeRemainingInfo(data: Buffer): { slices: Slice[] } {
  let o = 24; // 8 discriminator + amount_in + min_amount_out
  const count = data.readUInt32LE(o); o += 4;
  const slices: Slice[] = [];
  for (let i = 0; i < count; i++) {
    const tag = data[o++];
    const name = ACCOUNTS_TYPES[tag];
    const accountsType = tag === 3 ? { [name]: { 0: data[o++] } } : { [name]: {} };
    slices.push({ accountsType, length: data[o++] });
  }
  return { slices };
}

export type ExecuteBuild = {
  ix: TransactionInstruction;
  quoteOut: BN;
  binArrays: PublicKey[];
};

/**
 * Quotes `amountIn` on the order's pool and returns the execute instruction. `keeperMinOut` is
 * advisory; the program always enforces the holder's own minimum.
 */
export async function buildExecuteIx(params: {
  program: Program;
  connection: Connection;
  orderPda: PublicKey;
  order: OrderAccount;
  amountIn: BN;
  keeper: PublicKey;
  keeperMinOut?: BN;
  /** Selects the DLMM program id. Use "devnet" or "mainnet-beta" even when connected to a local validator
   *  that clones those programs: the SDK maps "localhost" to a different program id. */
  cluster?: "devnet" | "mainnet-beta";
  overrides?: Partial<Record<(typeof SWAP2_FIXED)[number], PublicKey>>;
}): Promise<ExecuteBuild> {
  const { program, connection, order, amountIn } = params;
  const dlmm = await DLMM.create(connection, order.pool, params.cluster ? { cluster: params.cluster as never } : undefined);
  const swapForY = dlmm.lbPair.tokenXMint.equals(order.inputMint);
  if (!swapForY) throw new Error("order input must be the pool's token X");
  const bins = await dlmm.getBinArrayForSwap(true, 8);
  const quote = dlmm.swapQuote(amountIn, true, new BN(100), bins);
  const tx = await dlmm.swap({
    inToken: order.inputMint, outToken: order.outputMint, inAmount: amountIn,
    minOutAmount: quote.minOutAmount, lbPair: order.pool, user: order.owner,
    binArraysPubkey: quote.binArraysPubkey,
  });
  const swapIx = tx.instructions.find((ix) => ix.programId.equals(DLMM_PROGRAM_ID));
  if (!swapIx) throw new Error("DLMM SDK did not return a swap instruction");

  const fixed = Object.fromEntries(SWAP2_FIXED.map((name, i) => [name, swapIx.keys[i].pubkey])) as Record<(typeof SWAP2_FIXED)[number], PublicKey>;
  Object.assign(fixed, params.overrides ?? {});
  const remaining = swapIx.keys.slice(SWAP2_FIXED.length).map((k) => ({ pubkey: k.pubkey, isSigner: false, isWritable: k.isWritable }));

  const ix = await program.methods
    .execute(amountIn, params.keeperMinOut ?? new BN(0), decodeRemainingInfo(Buffer.from(swapIx.data)))
    .accountsStrict({
      keeper: params.keeper,
      order: params.orderPda,
      userTokenIn: fixed.userTokenIn,
      userTokenOut: fixed.userTokenOut,
      lbPair: fixed.lbPair,
      binArrayBitmapExtension: fixed.binArrayBitmapExtension,
      reserveX: fixed.reserveX,
      reserveY: fixed.reserveY,
      tokenXMint: fixed.tokenXMint,
      tokenYMint: fixed.tokenYMint,
      oracle: fixed.oracle,
      hostFeeIn: fixed.hostFeeIn,
      tokenXProgram: fixed.tokenXProgram,
      tokenYProgram: fixed.tokenYProgram,
      memoProgram: fixed.memoProgram,
      eventAuthority: fixed.eventAuthority,
      dlmmProgram: fixed.dlmmProgram,
    })
    .remainingAccounts(remaining)
    .instruction();
  return { ix, quoteOut: quote.outAmount, binArrays: quote.binArraysPubkey };
}
