import { NextRequest, NextResponse } from "next/server";
import { get } from "@/lib/db";

// 酒神のキャラ絵（OpenAI生成・gods.god_art に保存）を配信。?v= で長期キャッシュ。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await get<{ god_art: ArrayBuffer | Uint8Array | null; god_art_type: string; god_art_url: string }>(
    "SELECT god_art, god_art_type, god_art_url FROM gods WHERE sake_id = ?",
    [Number(id)]
  );
  // CDN(Blob)へ移設済みならそちらへリダイレクト（DBのBLOBを読まない）。
  if (row?.god_art_url) {
    return NextResponse.redirect(row.god_art_url, { status: 308, headers: { "Cache-Control": "public, max-age=3600" } });
  }
  if (!row?.god_art) return new NextResponse(null, { status: 404 });
  const bytes = row.god_art instanceof Uint8Array ? row.god_art : new Uint8Array(row.god_art);
  const versioned = req.nextUrl.searchParams.has("v");
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": row.god_art_type || "image/png",
      "Cache-Control": versioned
        ? "public, max-age=31536000, s-maxage=31536000, immutable"
        : "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}
