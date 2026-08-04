import { NextRequest, NextResponse } from "next/server";
import { run } from "@/lib/db";
import { readGuest, newGuestId, guestCookieOptions, GUEST_COOKIE } from "@/lib/guest";

// 匿名（ゲストCookie）のランキング表示名を設定（任意）。種類数は guest_tasted から自動集計するので不要。
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { name?: string };
  const name = String(b.name ?? "").trim().slice(0, 12);
  const existing = await readGuest();
  const gid = existing || newGuestId();
  await run(
    `INSERT INTO guests (guest_id, name, updated_at) VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(guest_id) DO UPDATE SET name = excluded.name, updated_at = datetime('now','localtime')`,
    [gid, name]
  );
  const res = NextResponse.json({ ok: true });
  if (!existing) res.cookies.set(GUEST_COOKIE, gid, guestCookieOptions());
  return res;
}
