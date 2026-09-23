import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Header } from "@/components/chrome";
import { Providers } from "@/components/providers";
import { Footer } from "@/components/sections";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Absolute URLs for link previews follow whatever host serves the page (local, tunnel, or deploy). */
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3417";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { ...metadata, metadataBase: new URL(`${proto}://${host}`) };
}

const metadata: Metadata = {
  title: { default: "Holdfill: hold through the lockup, fill before the deadline", template: "%s | Holdfill" },
  description:
    "Standing exit orders for SpaceX PreStocks. Set your price once. Holdfill converts into SPCXx when the pool pays it, never below your terms and never after the issuer deadline.",
  openGraph: {
    title: "Holdfill",
    description: "Hold through the lockup. Fill before the deadline.",
    images: [{ url: "/images/launch-dusk.jpg", width: 2400, height: 1600, alt: "A rocket's launch trail arcing across a dusk sky" }],
  },
};

export const viewport: Viewport = { themeColor: "#ffffff", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-dvh">
        <Providers>
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
