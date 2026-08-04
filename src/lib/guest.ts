import { cookies } from "next/headers";

// 匿名（LINE未登録）の図鑑をサーバー保存するための端末ごとのゲストID（httpOnly Cookie）。
// localStorageが消えても残る＝LINE登録なしでも図鑑が残る。
export const GUEST_COOKIE = "sksl_guest";

// 既存のゲストCookieを読む（無ければ null）
export async function readGuest(): Promise<string | null> {
  const c = await cookies();
  const v = c.get(GUEST_COOKIE)?.value || "";
  return /^g_[a-z0-9]{8,64}$/i.test(v) ? v : null;
}

export function newGuestId(): string {
  return "g_" + crypto.randomUUID().replace(/-/g, "");
}

export function guestCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1年
    path: "/",
  };
}
