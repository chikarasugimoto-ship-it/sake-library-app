import { NextRequest, NextResponse } from "next/server";

// MO → 酒コレ の入口（互換用）。GET /api/auth/mo-bridge?mob=<署名トークン>&t=<卓>&src=<計測タグ>
// 以前は MO の LINE 会員として酒コレにログインさせ、酒神コレクションを本人に紐づけていた。
// 2026-10-01 に図鑑・会員をやめたので、いまは卓つきの注文画面（/t/{卓}）へ送るだけ。
// MO 側のリンク（mob= 付き）がそのまま残っていても壊れないように、この URL は残す。
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const table = String(url.searchParams.get("t") || "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 12);
  const src = String(url.searchParams.get("src") || "").replace(/[^a-z]/g, "").slice(0, 8);
  const dest = (table ? `/t/${encodeURIComponent(table)}` : "/") + (src ? `?src=${src}` : "");
  return NextResponse.redirect(new URL(dest, req.url));
}
