import { NextRequest, NextResponse } from "next/server";
import { all, get, run, audit } from "@/lib/db";
import { isOwner, hashPassword, ensureStaffSeed } from "@/lib/auth";

async function adminCount(): Promise<number> {
  const r = await get<{ n: number }>("SELECT COUNT(*) AS n FROM staff WHERE role = 'admin'");
  return Number(r?.n ?? 0);
}

// 一覧（管理者のみ）
export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await ensureStaffSeed();
  const staff = await all<{ id: number; name: string; role: string; last_login: string }>(
    "SELECT id, name, role, last_login FROM staff ORDER BY (role='admin') DESC, id"
  );
  return NextResponse.json({ staff });
}

// スタッフ追加
export async function POST(req: NextRequest) {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json()) as { name?: string; password?: string; role?: string };
  const name = (b.name ?? "").trim().slice(0, 30);
  const password = String(b.password ?? "");
  if (!name) return NextResponse.json({ error: "名前を入れてください" }, { status: 400 });
  if (password.length < 4) return NextResponse.json({ error: "パスワードは4文字以上にしてください" }, { status: 400 });
  const exists = await get("SELECT id FROM staff WHERE name = ?", [name]);
  if (exists) return NextResponse.json({ error: "同じ名前のスタッフがいます" }, { status: 409 });
  const role = b.role === "admin" ? "admin" : "staff";
  await run("INSERT INTO staff (name, pass_hash, role) VALUES (?, ?, ?)", [name, hashPassword(password), role]);
  await audit("staff.add", { name, role });
  return NextResponse.json({ ok: true });
}

// パスワード初期化 / 権限変更
export async function PATCH(req: NextRequest) {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json()) as { id?: number; password?: string; role?: string };
  const id = Number(b.id);
  const target = await get<{ id: number; role: string }>("SELECT id, role FROM staff WHERE id = ?", [id]);
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (typeof b.password === "string") {
    if (b.password.length < 4) return NextResponse.json({ error: "パスワードは4文字以上にしてください" }, { status: 400 });
    await run("UPDATE staff SET pass_hash = ? WHERE id = ?", [hashPassword(b.password), id]);
    await audit("staff.resetpw", { id });
  }
  if (b.role === "admin" || b.role === "staff") {
    // 最後の管理者を一般に降格させない
    if (target.role === "admin" && b.role === "staff" && (await adminCount()) <= 1) {
      return NextResponse.json({ error: "管理者が0人になるため変更できません" }, { status: 409 });
    }
    await run("UPDATE staff SET role = ? WHERE id = ?", [b.role, id]);
    await audit("staff.role", { id, role: b.role });
  }
  return NextResponse.json({ ok: true });
}

// 削除
export async function DELETE(req: NextRequest) {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json()) as { id?: number };
  const id = Number(b.id);
  const target = await get<{ id: number; role: string }>("SELECT id, role FROM staff WHERE id = ?", [id]);
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (target.role === "admin" && (await adminCount()) <= 1) {
    return NextResponse.json({ error: "最後の管理者は削除できません" }, { status: 409 });
  }
  await run("DELETE FROM staff WHERE id = ?", [id]);
  await audit("staff.delete", { id });
  return NextResponse.json({ ok: true });
}
