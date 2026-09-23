import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";

const IDL_PATH = path.resolve(__dirname, "../idl/holdfill_orders.json");

/** holdfill_orders client. The wallet is only used as the default fee payer for `.rpc()` calls. */
export function loadProgram(connection: Connection, payer: Keypair): Program {
  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  return new Program(idl, new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" }));
}
