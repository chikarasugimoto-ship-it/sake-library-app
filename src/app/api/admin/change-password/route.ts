import { NextRequest, NextResponse } from "next/server";
import { currentStaff, passwordHashFor, passwordMatches, LOGIN_SETUP_NO_KEY } from "@/lib/auth";
import { get, run, audit } from "@/lib/db";
import { PASSWORD_REQUIRED } from "@/lib/staff-login";

// ログイン中のスタッフが自分のパスワードを変更する（杉本含む全員）
export async function POST(req: NextRequest) {
  const s = await currentStaff();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // パスワードなしの設定（2026-11-26〜）のあいだは、保存してあるパスワードを書きかえさせない。
  // だれでも入れるあいだは、パスワードを入れる口を開けない（パスワードに戻すと、前のパスワードはどれも通らず、全員、入れ直しになる）
  if (!PASSWORD_REQUIRED) return NextResponse.json({ error: "いまは、パスワードなしの設定です（変えるパスワードはありません）" }, { status: 409 });

  const b = (await req.json()) as { current?: string; newPassword?: string };
  const newPw = String(b.newPassword ?? "");
  if (newPw.length < 4) return NextResponse.json({ error: "新しいパスワードは4文字以上にしてください" }, { status: 400 });

  const row = await get<{ id: number; name: string; pass_hash: string }>(
    "SELECT id, name, pass_hash FROM staff WHERE id = ?",
    [s.id]
  );
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!passwordMatches(row.name, row.pass_hash, String(b.current ?? ""))) {
    return NextResponse.json({ error: "現在のパスワードが違います" }, { status: 401 });
  }
  const hash = passwordHashFor(row.name, newPw);
  if (hash == null) return NextResponse.json({ error: LOGIN_SETUP_NO_KEY }, { status: 503 });

  await run("UPDATE staff SET pass_hash = ? WHERE id = ?", [hash, s.id]);
  await audit("staff.changepw", { id: s.id });
  return NextResponse.json({ ok: true, name: row.name });
}
