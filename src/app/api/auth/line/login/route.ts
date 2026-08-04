import { NextRequest, NextResponse } from "next/server";
import { authorizeUrl, lineConfigured, randomState, OAUTH_STATE_COOKIE } from "@/lib/line";

// LINEログイン開始：state をCookieに置いてLINEの認可画面へ
export async function GET(req: NextRequest) {
  if (!lineConfigured()) {
    return NextResponse.json({ error: "LINEログイン未設定" }, { status: 503 });
  }
  const state = randomState();
  const res = NextResponse.redirect(authorizeUrl(state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/",
  });
  return res;
}
