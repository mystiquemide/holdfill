import "server-only";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, type Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { loadProgram, orders } from "../../../keeper/program";
import { cached } from "./cache";
import { DEVNET, MAINNET, SPACEX_TERMS, devnet, mainnet } from "./env";

type TokenBalance = { raw: string; ui: number; shares?: number };

export type Position = {
  owner: string;
  asOf: string;
  mainnet: { network: "mainnet"; spacex: TokenBalance };
  devnet: {
    network: "devnet";
    sol: number;
    replicaSpacex: TokenBalance & { delegate: string | null; delegatedRaw: string };
    replicaSpcxx: TokenBalance;
    order: null | {
      address: string;
      status: "active" | "filled";
      sizeRaw: string;
      filledRaw: string;
      receivedRaw: string;
      limitBps: number;
      fallbackAt: string;
      fallbackFloorBps: number;
      deadline: string;
      feeBps: number;
      approvalInPlace: boolean;
      haircutNowBps: number;
      minSpcxxPerShareNow: number;
    };
  };
};

async function balanceByMint(conn: Connection, owner: PublicKey, mint: PublicKey, decimals: number) {
  const res = await conn.getParsedTokenAccountsByOwner(owner, { mint, programId: TOKEN_2022_PROGRAM_ID }, "confirmed");
  let raw = 0n;
  let delegate: string | null = null;
  let delegatedRaw = 0n;
  for (const { account } of res.value) {
    const info = account.data.parsed.info;
    raw += BigInt(info.tokenAmount.amount);
    if (info.delegate) { delegate = info.delegate; delegatedRaw += BigInt(info.delegatedAmount?.amount ?? "0"); }
  }
  return { raw, ui: Number(raw) / 10 ** decimals, delegate, delegatedRaw };
}

async function loadPosition(owner: PublicKey): Promise<Position> {
  const now = Math.floor(Date.now() / 1000);
  const program = loadProgram(devnet(), Keypair.generate());
  const orderPda = PublicKey.findProgramAddressSync([Buffer.from("order"), owner.toBuffer(), DEVNET.spacex.toBuffer()], DEVNET.programId)[0];

  const [main, rSpacex, rSpcxx, sol, order] = await Promise.all([
    balanceByMint(mainnet(), owner, MAINNET.spacex, 9),
    balanceByMint(devnet(), owner, DEVNET.spacex, 9),
    balanceByMint(devnet(), owner, DEVNET.spcxx, 8),
    devnet().getBalance(owner, "confirmed"),
    orders(program).fetchNullable(orderPda),
  ]);

  const shares = (ui: number) => ui * SPACEX_TERMS.sharesPerToken;
  let orderView: Position["devnet"]["order"] = null;
  if (order) {
    const fallbackTs = Number(order.fallbackTs.toString());
    const haircutNowBps = now < fallbackTs ? order.limitBps : 10_000 - order.fallbackFloorBps;
    orderView = {
      address: orderPda.toBase58(),
      status: "filled" in order.status ? "filled" : "active",
      sizeRaw: order.size.toString(),
      filledRaw: order.filled.toString(),
      receivedRaw: order.received.toString(),
      limitBps: order.limitBps,
      fallbackAt: new Date(fallbackTs * 1000).toISOString(),
      fallbackFloorBps: order.fallbackFloorBps,
      deadline: new Date(Number(order.expiryTs.toString()) * 1000).toISOString(),
      feeBps: order.feeBps,
      approvalInPlace: rSpacex.delegate === orderPda.toBase58() && rSpacex.delegatedRaw > 0n,
      haircutNowBps,
      // Entitlement is 1 SPCXx per share, so the minimum per share is 1 minus the haircut in force.
      minSpcxxPerShareNow: 1 - haircutNowBps / 10_000,
    };
  }

  return {
    owner: owner.toBase58(),
    asOf: new Date().toISOString(),
    mainnet: { network: "mainnet", spacex: { raw: main.raw.toString(), ui: main.ui, shares: shares(main.ui) } },
    devnet: {
      network: "devnet",
      sol: sol / LAMPORTS_PER_SOL,
      replicaSpacex: { raw: rSpacex.raw.toString(), ui: rSpacex.ui, shares: shares(rSpacex.ui), delegate: rSpacex.delegate, delegatedRaw: rSpacex.delegatedRaw.toString() },
      replicaSpcxx: { raw: rSpcxx.raw.toString(), ui: rSpcxx.ui },
      order: orderView,
    },
  };
}

export const getPosition = (owner: PublicKey) => cached(`position:${owner.toBase58()}`, 5_000, () => loadPosition(owner));
