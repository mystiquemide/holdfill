// Review-link beacon. Visitors who open Holdfill through the link shared with hackathon reviewers
// carry the `_hf` cookie; their page views and key actions are sent to the maintainer's Telegram.
// Nobody else is tracked. Fails silently: it must never affect a page or a transaction.
export const REVIEW_COOKIE = "_hf";

export function reviewId(cookieHeader: string | null): string | null {
  const m = cookieHeader?.match(/(?:^|;\s*)_hf=([a-z0-9]{6,12})/);
  return m ? m[1] : null;
}

export async function beacon(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {}
}

/** "Chrome on macOS" from a user agent, good enough to tell visitors apart. */
export function device(ua: string | null): string {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /Firefox\//.test(s) ? "Firefox" : /Chrome\//.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "browser";
  const os = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Mac OS X/.test(s) ? "macOS" : /Windows/.test(s) ? "Windows" : /Linux/.test(s) ? "Linux" : "unknown OS";
  return `${browser} on ${os}`;
}
