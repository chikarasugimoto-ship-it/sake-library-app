import { NextRequest, NextResponse } from "next/server";
import { get } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await get<{ photo: ArrayBuffer | Uint8Array | null; photo_type: string; photo_url: string; updated_at: string }>(
    "SELECT photo, photo_type, photo_url, updated_at FROM sakes WHERE id = ?",
    [Number(id)]
  );
  // CDN(Blob)へ移設済みならそちらへリダイレクト＝DBのBLOBを読まない（高速・DB負荷減）。
  if (row?.photo_url) {
    return NextResponse.redirect(row.photo_url, { status: 308, headers: { "Cache-Control": "public, max-age=3600" } });
  }
  if (!row?.photo) return new NextResponse(null, { status: 404 });
  const bytes = row.photo instanceof Uint8Array ? row.photo : new Uint8Array(row.photo);
  // ?v=（updated_atバージョン）付きなら実質1年の不変キャッシュ＝ブラウザ/CDNが即返す。
  // 写真を撮り直すと updated_at が変わりURLも変わるので、古いキャッシュに引っ張られず即差し替わる。
  const versioned = req.nextUrl.searchParams.has("v");
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": row.photo_type || "image/jpeg",
      "Cache-Control": versioned
        ? "public, max-age=31536000, s-maxage=31536000, immutable"
        : "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}
