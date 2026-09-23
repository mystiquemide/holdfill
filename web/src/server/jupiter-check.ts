import "server-only";
import { cached } from "./cache";
import { MAINNET } from "./env";

// Any address works as maker: Jupiter validates the mints before the maker's balance. This is the
// Holdfill devnet issuer address, which holds nothing on mainnet. No order is signed or sent.
const MAKER = "12fN9mtc7x93AyTCpwzLUDPdu2k5h5YswfNigayAYzDg";
const ENDPOINT = "https://lite-api.jup.ag/trigger/v1/createOrder";

export type JupiterCheck = {
  network: "mainnet";
  checkedAt: string;
  endpoint: string;
  prestocks: { inputMint: string; httpStatus: number; accepted: boolean; response: unknown };
  control: { inputMint: string; label: string; httpStatus: number; accepted: boolean };
};

/** Asks Jupiter Trigger V1 to build a limit order. Nothing is signed or sent. */
export async function createOrder(inputMint: string, makingAmount: string) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inputMint, outputMint: MAINNET.usdc.toBase58(), maker: MAKER, payer: MAKER,
      params: { makingAmount, takingAmount: "1000000000" }, computeUnitPrice: "auto",
    }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  const accepted = res.ok && !!body && typeof body === "object" && "transaction" in body;
  return { httpStatus: res.status, accepted, body };
}

async function load(): Promise<JupiterCheck> {
  const [pre, ctl] = await Promise.all([
    createOrder(MAINNET.spacex.toBase58(), "100000000"),
    createOrder(MAINNET.spcxx.toBase58(), "10000000"),
  ]);
  return {
    network: "mainnet",
    checkedAt: new Date().toISOString(),
    endpoint: ENDPOINT,
    prestocks: { inputMint: MAINNET.spacex.toBase58(), httpStatus: pre.httpStatus, accepted: pre.accepted, response: pre.body },
    control: { inputMint: MAINNET.spcxx.toBase58(), label: "SpaceX xStock (SPCXx), no transfer fee", httpStatus: ctl.httpStatus, accepted: ctl.accepted },
  };
}

export const getJupiterCheck = () => cached("jupiter-check", 60_000, load);
