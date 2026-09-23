import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { REVIEW_COOKIE, beacon, device, reviewId } from "@/server/beacon";

const TAG = "via";
const REVIEW_VALUE = "sl";

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const url = request.nextUrl;
  const country = request.headers.get("x-vercel-ip-country") ?? "??";
  const who = `${device(request.headers.get("user-agent"))}, ${country}`;

  // Arrival through the review link: mark the session, then continue on the clean URL.
  if (url.searchParams.get(TAG) === REVIEW_VALUE) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const clean = url.clone();
    clean.searchParams.delete(TAG);
    const res = NextResponse.redirect(clean);
    res.cookies.set(REVIEW_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 30 });
    event.waitUntil(beacon(`Holdfill review visit ${id}: opened ${clean.pathname}${clean.search} (${who})`));
    return res;
  }

  // Later page views in a marked session. Prefetches are not views.
  const id = reviewId(request.headers.get("cookie"));
  const prefetch = request.headers.get("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
  if (id && !prefetch) event.waitUntil(beacon(`Holdfill review ${id}: ${url.pathname}${url.search.replace(/[?&]_rsc=[^&]*/, "")} (${who})`));
  return NextResponse.next();
}

export const config = {
  // Pages only: no API routes, static files, images, or the icon.
  matcher: ["/((?!api|_next|images|logos|icon|favicon).*)"],
};
