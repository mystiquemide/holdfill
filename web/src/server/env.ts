import "server-only";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import devnetConfig from "../../../config/devnet.json";

export const MAINNET = {
  spacex: new PublicKey("PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh"),
  spcxx: new PublicKey("Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8"),
  pool: new PublicKey("F9oJK3UC6bLVcAoYEZPHNteZACb7YzdZw7FHad4KFC6B"),
  usdc: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
};

export const DEVNET = {
  spacex: new PublicKey(devnetConfig.replicaSpacex),
  spcxx: new PublicKey(devnetConfig.replicaSpcxx),
  pool: new PublicKey(devnetConfig.pool),
  programId: new PublicKey(devnetConfig.programId),
  lifecycleEvent: new PublicKey(devnetConfig.lifecycleEvent),
};

/** Devnet markets for PreStocks with no issuer event: replica token against replica USDC (classic SPL Token). */
export const USDC_MARKETS: Record<string, { symbol: string; name: string; mint: PublicKey; pool: PublicKey; mainnetMint: PublicKey }> =
  Object.fromEntries(Object.entries(devnetConfig.markets).map(([symbol, m]) => [symbol, {
    symbol, name: m.name, mint: new PublicKey(m.mint), pool: new PublicKey(m.pool), mainnetMint: new PublicKey(m.mainnetMint),
  }]));
export const DEVNET_USDC = new PublicKey(devnetConfig.replicaUsdc);

/** Issuer-stated terms for SpaceX PreStocks (prestocks.com/spacex). */
export const SPACEX_TERMS = {
  sharesPerToken: 5,
  deadline: "2027-03-12T23:59:00Z",
  deadlineSource: "https://prestocks.com/spacex",
};

function heliusKey(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not set");
  return key;
}

let mainnetConn: Connection | undefined;
let devnetConn: Connection | undefined;
export const mainnet = () => (mainnetConn ??= new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusKey()}`, "confirmed"));
export const devnet = () => (devnetConn ??= new Connection(`https://devnet.helius-rpc.com/?api-key=${heliusKey()}`, "confirmed"));

/** Reads a keypair from an env var holding the JSON secret key array. */
export function keypairFromEnv(name: "KEEPER_KEYPAIR" | "FAUCET_KEYPAIR"): Keypair {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is not set`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}
