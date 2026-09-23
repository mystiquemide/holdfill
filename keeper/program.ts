import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Idl, Program } from "@anchor-lang/core";
import { Wallet } from "@anchor-lang/core";
import idl from "../idl/holdfill_orders.json";
import type { OrderAccount } from "./execute-ix";

/** holdfill_orders client. The wallet is only used as the default fee payer for `.rpc()` calls. */
export function loadProgram(connection: Connection, payer: Keypair): Program {
  return new Program(idl as Idl, new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" }));
}

export type OrderStatus = { active: Record<string, never> } | { filled: Record<string, never> };
export type OrderData = OrderAccount & { status: OrderStatus; createdAt: OrderAccount["size"]; bump: number };

type OrderClient = {
  fetchNullable(address: PublicKey): Promise<OrderData | null>;
  all(): Promise<{ publicKey: PublicKey; account: OrderData }[]>;
};

/** Typed access to the Order account client generated from the IDL. */
export const orders = (program: Program): OrderClient =>
  (program.account as unknown as { order: OrderClient }).order;
