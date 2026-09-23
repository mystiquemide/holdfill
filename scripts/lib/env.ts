import fs from "node:fs";
import path from "node:path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export const ROOT = path.resolve(__dirname, "../..");
export const DEVNET_CONFIG = path.join(ROOT, "config/devnet.json");

// Mainnet facts the replicas copy (verified on chain, 22 Sep 2026).
export const MAINNET = {
  spacex: new PublicKey("PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh"),
  spcxx: new PublicKey("Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8"),
  pool: new PublicKey("F9oJK3UC6bLVcAoYEZPHNteZACb7YzdZw7FHad4KFC6B"),
  usdc: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
};
export const DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

function heliusKey(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY is not set");
  return key;
}

export const mainnet = () => new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusKey()}`, "confirmed");
export const devnet = () => new Connection(`https://devnet.helius-rpc.com/?api-key=${heliusKey()}`, "confirmed");

export function loadKeypair(envName: string, fallbackPath: string): Keypair {
  const file = process.env[envName] ?? fallbackPath;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}

export const issuerKeypair = () => loadKeypair("ISSUER_KEYPAIR_PATH", "/root/.config/holdfill/issuer.json");

export type DevnetConfig = {
  cluster: "devnet";
  issuer?: string;
  replicaSpacex?: string;
  replicaSpcxx?: string;
  pool?: string;
  presetParameter?: string;
  binStep?: number;
  initialActiveId?: number;
  positions?: string[];
  poolPath?: string;
  lastSync?: { at: string; mainnetPrice: number; devnetPrice: number; diffPct: number };
  proofTransactions?: Record<string, string>;
  [key: string]: unknown;
};

export function readConfig(): DevnetConfig {
  if (!fs.existsSync(DEVNET_CONFIG)) return { cluster: "devnet" };
  return JSON.parse(fs.readFileSync(DEVNET_CONFIG, "utf8"));
}

export function writeConfig(cfg: DevnetConfig) {
  fs.mkdirSync(path.dirname(DEVNET_CONFIG), { recursive: true });
  fs.writeFileSync(DEVNET_CONFIG, JSON.stringify(cfg, null, 2) + "\n");
}
