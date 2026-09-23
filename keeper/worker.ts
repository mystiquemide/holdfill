// Long-running keeper: one tick every KEEPER_INTERVAL_MS (default 10 s). Logs one JSON line per
// attempt. The keeper wallet only pays transaction fees and never holds tokens.
import { Connection } from "@solana/web3.js";
import { loadKeypair } from "../scripts/lib/env";
import { loadProgram } from "./program";
import { tick } from "./tick";

const interval = Number(process.env.KEEPER_INTERVAL_MS ?? 10_000);
const rpc = process.env.KEEPER_RPC_URL ?? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const connection = new Connection(rpc, "confirmed");
const keeper = loadKeypair("KEEPER_KEYPAIR_PATH", "/root/.config/holdfill/keeper.json");
const program = loadProgram(connection, keeper);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const line = (o: object) => console.log(JSON.stringify({ at: new Date().toISOString(), ...o }));

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

(async () => {
  line({ event: "start", keeper: keeper.publicKey.toBase58(), program: program.programId.toBase58(), intervalMs: interval });
  while (!stopping) {
    const started = Date.now();
    try {
      const attempts = await tick({ connection, program, keeper, cluster: "devnet", log: (a) => line({ event: "attempt", ...a }) });
      line({ event: "tick", orders: attempts.length, filled: attempts.filter((a) => a.action === "filled").length, ms: Date.now() - started });
    } catch (e: any) {
      line({ event: "error", message: String(e?.message ?? e).slice(0, 200) });
    }
    await sleep(Math.max(0, interval - (Date.now() - started)));
  }
  line({ event: "stop" });
})();
