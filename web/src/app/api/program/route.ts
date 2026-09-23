import { PublicKey } from "@solana/web3.js";
import { cached } from "@/server/cache";
import { DEVNET, devnet } from "@/server/env";

const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

/** Program id and its current upgrade authority, read from the devnet ProgramData account. */
export async function GET() {
  try {
    const body = await cached("program", 60_000, async () => {
      const [programData] = PublicKey.findProgramAddressSync([DEVNET.programId.toBuffer()], LOADER);
      const info = await devnet().getAccountInfo(programData, "confirmed");
      if (!info) throw new Error("program data account not found");
      // UpgradeableLoaderState::ProgramData: u32 tag, u64 slot, Option<Pubkey> authority.
      const hasAuthority = info.data[12] === 1;
      return {
        network: "devnet",
        asOf: new Date().toISOString(),
        programId: DEVNET.programId.toBase58(),
        lastDeploySlot: Number(info.data.readBigUInt64LE(4)),
        upgradeAuthority: hasAuthority ? new PublicKey(info.data.subarray(13, 45)).toBase58() : null,
      };
    });
    return Response.json(body, { headers: { "Cache-Control": "public, s-maxage=60" } });
  } catch (e) {
    return Response.json({ error: "program state unavailable", detail: String((e as Error).message).slice(0, 200) }, { status: 503 });
  }
}
