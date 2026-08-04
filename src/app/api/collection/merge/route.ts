import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, MEMBER_COOKIE } from "@/lib/line";
import { readGuest, newGuestId, guestCookieOptions, GUEST_COOKIE } from "@/lib/guest";
import { run } from "@/lib/db";

// 端末保存（localStorage）の図鑑をサーバーへ統合する。
// 会員（LINE）→ member_tasted、匿名 → guest_tasted（ゲストCookie）。
export async function POST(req: NextRequest) {
  const c = await cookies();
  const uid = verifySession(c.get(MEMBER_COOKIE)?.value);
  const b = (await req.json()) as { tasted?: Record<string, { count: number; date: string }> };
  const tasted = b.tasted ?? {};

  if (uid) {
    for (const [id, v] of Object.entries(tasted)) {
      const sakeId = Number(id);
      if (!Number.isInteger(sakeId) || sakeId <= 0) continue;
      await run(
        "INSERT INTO member_tasted (line_user_id, sake_id, tasted_date, count) VALUES (?, ?, ?, ?) ON CONFLICT(line_user_id, sake_id) DO NOTHING",
        [uid, sakeId, String(v?.date || ""), Math.max(1, Number(v?.count) || 1)]
      );
    }
    return NextResponse.json({ ok: true });
  }

  // 匿名：ゲストCookieへ統合（無ければ発行）
  const existing = await readGuest();
  const gid = existing || newGuestId();
  for (const [id, v] of Object.entries(tasted)) {
    const sakeId = Number(id);
    if (!sakeId) continue;
    await run(
      "INSERT INTO guest_tasted (guest_id, sake_id, tasted_date, count) VALUES (?, ?, ?, ?) ON CONFLICT(guest_id, sake_id) DO NOTHING",
      [gid, sakeId, String(v?.date || ""), Math.max(1, Number(v?.count) || 1)]
    );
  }
  const res = NextResponse.json({ ok: true });
  if (!existing) res.cookies.set(GUEST_COOKIE, gid, guestCookieOptions());
  return res;
}
