import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/db";

// 卓専用QRの着地点。/t/{卓番号} を開くと、その卓を記憶してオープニング（見出し）へ→注文画面。
// 注文時にこの卓番号をスマレジのテーブル利用に紐付ける。
// ※図鑑のゲストCookie(sksl_guest)はミドルウェアが実ページ(200)で発行する（iOSで確実に残すため）。
export async function GET(req: NextRequest, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  const t = String(table).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 12);
  // src= はMO側のどの露出から流入したかの計測タグ（hero/tab/done/drink/chip）。失敗しても着地は止めない
  const src = String(req.nextUrl.searchParams.get("src") || "").replace(/[^a-z]/g, "").slice(0, 8);
  if (src) { try { await audit("mo.inflow", { src, table: t }); } catch { /* 計測は任意 */ } }
  const res = NextResponse.redirect(new URL(`/welcome?t=${encodeURIComponent(t)}`, req.url));
  res.cookies.set("sksl_table", t, {
    path: "/",
    maxAge: 60 * 60 * 6, // 6時間（来店中のみ）
    sameSite: "lax",
  });
  // 卓セッションのひもづけはリセット（新しい来店/会計後の再読み込みで、現在のセッションに付け直す）
  res.cookies.delete("sksl_tuse");
  return res;
}
