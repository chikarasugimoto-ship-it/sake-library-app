import { NextRequest, NextResponse } from "next/server";
import { STAFF_COOKIE, signStaff, verifyStaffLogin, listStaff } from "@/lib/auth";
import { audit } from "@/lib/db";
import { PASSWORD_REQUIRED } from "@/lib/staff-login";

// 2026-11-26 オーナー指示で、パスワードなし（PASSWORD_REQUIRED = false）。名前が合えば、パスワードを見ずに入れる（auth.ts の verifyStaffLogin）。
// 雑なブルートフォース対策（プロセス内）
let failures = 0;
let blockedUntil = 0;

// ログイン画面の名前ピッカー用：スタッフ名一覧（パスワード等は返さない）
export async function GET() {
  const staff = await listStaff();
  return NextResponse.json({ staff: staff.map((s) => ({ name: s.name, role: s.role })) });
}

export async function POST(req: NextRequest) {
  if (Date.now() < blockedUntil) {
    return NextResponse.json({ error: "しばらく待ってからお試しください" }, { status: 429 });
  }
  const { name, password } = (await req.json()) as { name?: string; password?: string };
  const sess = await verifyStaffLogin(String(name ?? ""), String(password ?? ""));
  if (!sess) {
    failures++;
    if (failures >= 8) {
      blockedUntil = Date.now() + 60_000;
      failures = 0;
    }
    return NextResponse.json({ error: PASSWORD_REQUIRED ? "名前またはパスワードが違います" : "その名前のスタッフが見つかりません" }, { status: 401 });
  }
  failures = 0;
  // nopw = パスワードなしの設定で入った（2026-11-26〜。あとで「だれが、どう入ったか」を見分けられるように残す）
  await audit("staff.login", PASSWORD_REQUIRED ? { id: sess.id, name } : { id: sess.id, name, nopw: true });
  const res = NextResponse.json({ ok: true, role: sess.role });
  res.cookies.set(STAFF_COOKIE, signStaff(sess.id, sess.role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  });
  return res;
}
