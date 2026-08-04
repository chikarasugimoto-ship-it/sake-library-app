import { NextRequest, NextResponse } from "next/server";
import { currentStaff, hashPassword } from "@/lib/auth";
import { get, run, audit } from "@/lib/db";

// ログイン中のスタッフが自分のパスワードを変更する（杉本含む全員）
export async function POST(req: NextRequest) {
  const s = await currentStaff();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = (await req.json()) as { current?: string; newPassword?: string };
  const newPw = String(b.newPassword ?? "");
  if (newPw.length < 4) return NextResponse.json({ error: "新しいパスワードは4文字以上にしてください" }, { status: 400 });

  const row = await get<{ id: number; name: string; pass_hash: string }>(
    "SELECT id, name, pass_hash FROM staff WHERE id = ?",
    [s.id]
  );
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.pass_hash !== hashPassword(String(b.current ?? ""))) {
    return NextResponse.json({ error: "現在のパスワードが違います" }, { status: 401 });
  }

  await run("UPDATE staff SET pass_hash = ? WHERE id = ?", [hashPassword(newPw), s.id]);
  await audit("staff.changepw", { id: s.id });
  return NextResponse.json({ ok: true, name: row.name });
}
