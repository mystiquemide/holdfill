// Display helpers shared by server and client components. Pure functions only.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function num(value: number, decimals = 4): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export const usd = (value: number, decimals = 2) => `$${num(value, decimals)}`;
export const pct = (value: number, decimals = 1) => `${value.toFixed(decimals)}%`;
export const int = (value: number) => Math.round(value).toLocaleString("en-US");

/** "$7.75M", "$546K", "$1,141" */
export const usdCompact = (value: number) =>
  value >= 1e6 ? `$${(value / 1e6).toFixed(2)}M` : value >= 1e4 ? `$${Math.round(value / 1e3)}K` : `$${int(value)}`;

/** "+25.1%" or "-2.0%" */
export const signedPct = (value: number, decimals = 1) => `${value > 0 ? "+" : ""}${value.toFixed(decimals)}%`;

/** "06:52 UTC" */
export function utcTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** "4 Aug" or "12 Mar 2027" when the year differs from 2026. */
export function day(iso: string, withYear?: boolean): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withYear ?? y !== 2026 ? `${base} ${y}` : base;
}

export const shortAddr = (a: string) => `${a.slice(0, 4)}...${a.slice(-4)}`;

export const explorerTx = (sig: string, cluster: "mainnet" | "devnet") =>
  `https://explorer.solana.com/tx/${sig}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
export const explorerAddr = (a: string, cluster: "mainnet" | "devnet") =>
  `https://explorer.solana.com/address/${a}${cluster === "devnet" ? "?cluster=devnet" : ""}`;

export const daysUntil = (iso: string, from = Date.now()) => Math.max(0, Math.ceil((Date.parse(iso) - from) / 86_400_000));

/** Plain-language versions of the keeper's reasons for skipping an order. */
export function explainSkip(reason: string): string {
  const r = reason.toLowerCase();
  const fee = r.match(/from (\d+) to (\d+) bps/);
  if (r.includes("paused")) return "The issuer paused this token. Your order can't fill until it resumes.";
  if (r.includes("transfer fee")) {
    const change = fee ? ` (from ${Number(fee[1]) / 100}% to ${Number(fee[2]) / 100}%)` : "";
    return `The issuer changed the transfer fee since you signed${change}. Revoke and set a new order to accept it.`;
  }
  if (r.includes("approval")) return "Your approval was removed. Revoke to close the order.";
  if (r.includes("expired")) return "This order expired. Revoke to close it and get its deposit back.";
  if (r.includes("deadline")) return "The issuer deadline passed. This order can no longer fill.";
  return "This order can't fill right now. Revoke it and set a new one.";
}

/** Plain-language versions of program and keeper error codes. */
export function explainError(code?: string): string {
  switch (code) {
    case "InsufficientOutput":
    case "ExceededAmountSlippageTolerance":
      return "The pool paid less than your minimum, so nothing moved.";
    case "MintPaused":
      return "The issuer paused this token.";
    case "FeeChanged":
      return "The issuer changed the transfer fee since you signed.";
    case "IssuerDeadlinePassed":
      return "The issuer deadline passed.";
    case "DelegateMismatch":
    case "InsufficientAllowance":
      return "Your approval no longer covers this fill.";
    case "OrderNotActive":
      return "The order was already filled.";
    case "AccountNotInitialized":
      return "The order was closed before this check.";
    case "BlockhashExpired":
      return "The signature took too long. Try again.";
    case "NotArmed":
      return "This order is already active.";
    case "InvalidExpiry":
      return "Pick an expiry within 400 days, before any issuer deadline.";
    case "WrongPoolMints":
      return "This pool doesn't trade this token against USDC. Reload the page and try again.";
    case "EventAlreadyRegistered":
      return "This token already has a conversion event. Set a regular order instead.";
    case "InvalidPrice":
      return "Enter a price above zero.";
    default:
      // Program error codes are single words. Anything else (a failed simulation, a timeout) never reached the chain.
      if (code && /^\w+$/.test(code)) return `Rejected on chain (${code}).`;
      return "The fill didn't go through this time, and nothing moved. Try again in a few seconds.";
  }
}
