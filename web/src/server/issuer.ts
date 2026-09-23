import "server-only";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import { loadProgram, orderKind, orders } from "../../../keeper/program";
import { cached } from "./cache";
import { DEVNET, DEVNET_USDC, SPACEX_TERMS, USDC_MARKETS, devnet } from "./env";
import { getMarkets } from "./markets";

/** Devnet replica mints that orders can use, by PreStocks symbol. Shares per raw token and output decimals differ. */
const DEVNET_MARKETS: Record<string, { symbol: string; sharesPerRaw: number; outDecimals: number; outSymbol: string }> = {
  [DEVNET.spacex.toBase58()]: { symbol: "SPACEX", sharesPerRaw: SPACEX_TERMS.sharesPerToken, outDecimals: 8, outSymbol: "SPCXx" },
  ...Object.fromEntries(Object.values(USDC_MARKETS).map((m) => [m.mint.toBase58(), { symbol: m.symbol, sharesPerRaw: 1, outDecimals: 6, outSymbol: "USDC" }])),
};
const BASE = 1e9;

export type IssuerOrder = {
  address: string; owner: string; symbol: string; kind: "convert" | "price" | "armed";
  status: "armed" | "partial" | "filled" | "blocked" | "expired";
  limitBps: number; sizeShares: number; filledShares: number; received: number; createdAt: string;
};

export type IssuerMarket = {
  symbol: string; name: string; ordersOpen: boolean;
  holders: number | null; markValueUsd: number; markUsd: number; deadline: string | null; daysLeft: number | null;
  orders: number; live: number; filled: number; blocked: number;
  coveredShares: number; coveredUsd: number; filledShares: number; received: number; receivedSymbol: string;
  price: number; armed: number;
};

export type IssuerView = { network: { orders: "devnet"; holders: "mainnet" }; asOf: string; markets: IssuerMarket[]; orders: IssuerOrder[] };

async function load(): Promise<IssuerView> {
  const conn = devnet();
  const program = loadProgram(conn, Keypair.generate());
  const [all, markets] = await Promise.all([orders(program).all(), getMarkets()]);

  // An order only covers anything while its approval is live: read each owner's input account once.
  const atas = all.map(({ account }) => getAssociatedTokenAddressSync(account.inputMint, account.owner, false, TOKEN_2022_PROGRAM_ID));
  const infos = atas.length ? await conn.getMultipleAccountsInfo(atas, "confirmed") : [];

  // Output decimals per mint: an activated armed order pays out in the successor, not the market default.
  const outMints = [...new Set(all.map(({ account }) => account.outputMint.toBase58()))].filter((m) => m !== "11111111111111111111111111111111");
  const outInfos = outMints.length ? await conn.getMultipleAccountsInfo(outMints.map((m) => new PublicKey(m)), "confirmed") : [];
  const decimalsOf = new Map(outMints.map((m, i) => [m, outInfos[i]?.data[44] ?? 6]));
  const nowSec = Math.floor(Date.now() / 1000);
  const rows: IssuerOrder[] = [];
  const remaining = new Map<string, number>();
  all.forEach(({ publicKey, account }, i) => {
    const market = DEVNET_MARKETS[account.inputMint.toBase58()];
    if (!market) return;
    const size = BigInt(account.size.toString());
    const filled = BigInt(account.filled.toString());
    const info = infos[i];
    const token = info ? unpackAccount(atas[i], info, TOKEN_2022_PROGRAM_ID) : null;
    const approved = !!token?.delegate?.equals(publicKey) && token.delegatedAmount > 0n;
    const isFilled = "filled" in account.status;
    const isArmed = "armed" in account.status;
    const expired = !isFilled && !isArmed && nowSec >= Number(account.expiryTs.toString());
    const status = isFilled ? "filled" : expired ? "expired" : !approved ? "blocked" : filled > 0n ? "partial" : "armed";
    const shares = (v: bigint) => (Number(v) / BASE) * market.sharesPerRaw;
    rows.push({
      address: publicKey.toBase58(), owner: account.owner.toBase58(), symbol: market.symbol, kind: orderKind(account), status,
      limitBps: account.limitBps, sizeShares: shares(size), filledShares: shares(filled),
      // Only fills in the market's usual output (SPCXx or USDC) add to "received"; successor fills count as shares.
      received: account.outputMint.toBase58() === (market.symbol === "SPACEX" ? DEVNET.spcxx : DEVNET_USDC).toBase58()
        ? Number(account.received.toString()) / 10 ** (decimalsOf.get(account.outputMint.toBase58()) ?? market.outDecimals)
        : 0,
      createdAt: new Date(Number(account.createdAt.toString()) * 1000).toISOString(),
    });
    if (status === "armed" || status === "partial") remaining.set(publicKey.toBase58(), shares(size - filled));
  });
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const open = new Set(Object.values(DEVNET_MARKETS).map((m) => m.symbol));
  return {
    network: { orders: "devnet", holders: "mainnet" },
    asOf: new Date().toISOString(),
    orders: rows,
    markets: markets.markets.map((m) => {
      const mine = rows.filter((r) => r.symbol === m.symbol);
      const coveredShares = mine.reduce((s, r) => s + (remaining.get(r.address) ?? 0), 0);
      return {
        symbol: m.symbol, name: m.name, ordersOpen: open.has(m.symbol),
        holders: m.holders, markValueUsd: m.markValueUsd, markUsd: m.markUsd,
        deadline: m.event?.deadline ?? null, daysLeft: m.event?.daysLeft ?? null,
        orders: mine.length,
        live: mine.filter((r) => r.status === "armed" || r.status === "partial").length,
        filled: mine.filter((r) => r.status === "filled").length,
        blocked: mine.filter((r) => r.status === "blocked").length,
        coveredShares, coveredUsd: coveredShares * m.markUsd,
        filledShares: mine.reduce((s, r) => s + r.filledShares, 0),
        received: mine.reduce((s, r) => s + r.received, 0),
        receivedSymbol: m.symbol === "SPACEX" ? "SPCXx" : "USDC",
        price: mine.filter((r) => r.kind === "price").length,
        armed: mine.filter((r) => r.kind === "armed").length,
      };
    }),
  };
}

export const getIssuerView = () => cached("issuer", 30_000, load);
