import { NextRequest, NextResponse } from "next/server";
import { STAFF_COOKIE, signStaff, verifyStaffLogin, listStaff } from "@/lib/auth";
import { audit } from "@/lib/db";

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
    return NextResponse.json({ error: "名前またはパスワードが違います" }, { status: 401 });
  }
  failures = 0;
  await audit("staff.login", { id: sess.id, name });
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
