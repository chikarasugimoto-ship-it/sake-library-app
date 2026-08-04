import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getProfile, signSession, newSlug, MEMBER_COOKIE, OAUTH_STATE_COOKIE } from "@/lib/line";
import { run, get, audit } from "@/lib/db";

// LINEログインのコールバック：state検証→トークン交換→プロフィール取得→会員登録→セッション付与
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const home = new URL("/zukan", req.url);

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(new URL("/zukan?login=cancel", req.url));
  }
  if (!code || !state || !saved || state !== saved) {
    return NextResponse.redirect(new URL("/zukan?login=error", req.url));
  }

  try {
    const tok = await exchangeCode(code);
    const profile = await getProfile(tok.access_token);
    await run(
      `INSERT INTO members (line_user_id, display_name, picture_url, last_login)
       VALUES (?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(line_user_id) DO UPDATE SET
         display_name = excluded.display_name,
         picture_url = excluded.picture_url,
         last_login = datetime('now','localtime')`,
      [profile.userId, profile.displayName ?? "", profile.pictureUrl ?? ""]
    );
    // 公開図鑑ページ用スラッグを未発行なら付与
    const row = await get<{ public_slug: string }>("SELECT public_slug FROM members WHERE line_user_id = ?", [profile.userId]);
    if (!row?.public_slug) {
      await run("UPDATE members SET public_slug = ? WHERE line_user_id = ?", [newSlug(), profile.userId]);
    }
    await audit("member.login", { userId: profile.userId, name: profile.displayName });

    const res = NextResponse.redirect(new URL("/zukan?welcome=1", home));
    res.cookies.set(MEMBER_COOKIE, signSession(profile.userId), {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  } catch (e) {
    await audit("member.login.error", { error: e instanceof Error ? e.message : "x" });
    return NextResponse.redirect(new URL("/zukan?login=error", req.url));
  }
}
