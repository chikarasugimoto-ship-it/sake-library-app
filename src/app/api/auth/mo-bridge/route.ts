import { NextRequest, NextResponse } from "next/server";
import { run, get, audit } from "@/lib/db";
import { signSession, MEMBER_COOKIE, newSlug } from "@/lib/line";
import { verifyBridge } from "@/lib/bridge";

// MO → 酒コレ 会員橋渡し（案②）。
// GET /api/auth/mo-bridge?mob=<署名トークン>&t=<卓>
//  - MOでLINEログイン済みのお客様が日本酒タブから来る。トークンを検証し、line_user_id="mo:<ext>" の会員として
//    ログイン（セッションCookie付与）→ 目的の /t/{卓}（無ければ /zukan）へ。
//  - これで酒神コレクションが「MOで連携した本人」に紐づいて保存される（別端末でも同じMO連携なら同一会員）。
//  - 検証失敗 or env未設定 は素通り（ゲストとして図鑑へ）＝体験を止めない。会計・在庫には一切触れない。
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const table = String(url.searchParams.get("t") || "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 12);
  // src=MO側のどの露出（hero/tab/done/drink/chip）から来たかの計測タグ。/t まで引き回す
  const src = String(url.searchParams.get("src") || "").replace(/[^a-z]/g, "").slice(0, 8);
  const dest = (table ? `/t/${encodeURIComponent(table)}` : "/zukan") + (src ? `?src=${src}` : "");

  const v = verifyBridge(url.searchParams.get("mob") || "");
  if (!v) return NextResponse.redirect(new URL(dest, req.url));

  try {
    const lineUserId = `mo:${v.ext}`;
    await run(
      `INSERT INTO members (line_user_id, display_name, last_login)
       VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(line_user_id) DO UPDATE SET
         display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE members.display_name END,
         last_login = datetime('now','localtime')`,
      [lineUserId, v.name]
    );
    const row = await get<{ public_slug: string }>("SELECT public_slug FROM members WHERE line_user_id = ?", [lineUserId]);
    if (!row?.public_slug) {
      await run("UPDATE members SET public_slug = ? WHERE line_user_id = ?", [newSlug(), lineUserId]);
    }
    await audit("member.mobridge", { ext: v.ext });

    const res = NextResponse.redirect(new URL(dest, req.url));
    res.cookies.set(MEMBER_COOKIE, signSession(lineUserId), {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
    return res;
  } catch (e) {
    await audit("member.mobridge.error", { error: e instanceof Error ? e.message : "x" });
    return NextResponse.redirect(new URL(dest, req.url));
  }
}
