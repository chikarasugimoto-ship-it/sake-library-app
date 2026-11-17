import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { all, get, run } from "./db";

export const STAFF_COOKIE = "sksl_staff";
const TEMP_PASS = "sugidama"; // 杉本以外の初期仮パスワード（各自/管理者が後で変更）

// セッション署名鍵（既存のADMIN_PASSWORD envを流用。未設定時は開発既定）
function signKey(): string {
  return process.env.ADMIN_PASSWORD || "sugidama-dev-key";
}
export function hashPassword(pw: string): string {
  return createHash("sha256").update("sksl.staff.v1:" + pw).digest("hex");
}

export type StaffSession = { id: number; role: "admin" | "staff" };

export function signStaff(id: number, role: string): string {
  const body = `${id}.${role}`;
  const sig = createHmac("sha256", signKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyStaffCookie(cookie?: string): StaffSession | null {
  if (!cookie) return null;
  const i = cookie.lastIndexOf(".");
  if (i < 0) return null;
  const body = cookie.slice(0, i);
  const sig = cookie.slice(i + 1);
  if (createHmac("sha256", signKey()).update(body).digest("base64url") !== sig) return null;
  const [idStr, role] = body.split(".");
  const id = Number(idStr);
  if (!id || (role !== "admin" && role !== "staff")) return null;
  return { id, role };
}

export async function currentStaff(): Promise<StaffSession | null> {
  const store = await cookies();
  return verifyStaffCookie(store.get(STAFF_COOKIE)?.value);
}
// 任意のスタッフがログイン済みか（在庫ボード等の管理画面アクセス可否）
export async function isAdmin(): Promise<boolean> {
  return !!(await currentStaff());
}
// 管理者（杉本）か（スタッフ管理ができる）
export async function isOwner(): Promise<boolean> {
  return (await currentStaff())?.role === "admin";
}

type StaffRow = { id: number; name: string; pass_hash: string; role: string };

// 初回のみ4名をシード（杉本=管理者:現行ADMIN_PASSWORD、他3名=仮パス）
export async function ensureStaffSeed(): Promise<void> {
  const cnt = await get<{ n: number }>("SELECT COUNT(*) AS n FROM staff");
  if (cnt && Number(cnt.n) > 0) return;
  const ownerPw = process.env.ADMIN_PASSWORD || "sugidama";
  const seed: [string, string, "admin" | "staff"][] = [
    ["杉本", hashPassword(ownerPw), "admin"],
    ["長山", hashPassword(TEMP_PASS), "staff"],
    ["細田", hashPassword(TEMP_PASS), "staff"],
    ["小倉", hashPassword(TEMP_PASS), "staff"],
  ];
  for (const [name, ph, role] of seed) {
    await run("INSERT INTO staff (name, pass_hash, role) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING", [name, ph, role]);
  }
}

export async function listStaff() {
  await ensureStaffSeed();
  return all<{ id: number; name: string; role: string; last_login: string }>(
    "SELECT id, name, role, last_login FROM staff ORDER BY (role='admin') DESC, id"
  );
}

// 管理者の復旧用: 入力が今の ADMIN_PASSWORD と一致するか（長さの違いで時間差が出ないようハッシュ同士を比べる）
export function ownerRecoveryMatches(role: string, password: string): boolean {
  if (role !== "admin") return false;
  const env = process.env.ADMIN_PASSWORD || "";
  if (env.length < 8 || !password) return false;
  return timingSafeEqual(Buffer.from(hashPassword(password)), Buffer.from(hashPassword(env)));
}

export async function verifyStaffLogin(name: string, password: string): Promise<StaffSession | null> {
  await ensureStaffSeed();
  const s = await get<StaffRow>("SELECT id, name, pass_hash, role FROM staff WHERE name = ?", [name]);
  if (!s) return null;
  if (!s.pass_hash || s.pass_hash !== hashPassword(password)) {
    // 管理者がパスワードを忘れたときの復旧（2026-11-18）。他のスタッフは管理者が戻せるが、管理者本人は戻す人がいない。
    // Vercel の ADMIN_PASSWORD を新しい値に入れ直す → その値で管理者としてログインでき、以後のパスワードもその値になる。
    // env を書き換えられるのは Vercel に入れる人だけ。env が未設定・短すぎる（8 文字未満）ときは使えない（開発既定値では通さない）。
    if (!ownerRecoveryMatches(s.role, password)) return null;
    await run("UPDATE staff SET pass_hash = ? WHERE id = ?", [hashPassword(password), s.id]);
  }
  await run("UPDATE staff SET last_login = datetime('now','localtime') WHERE id = ?", [s.id]);
  return { id: s.id, role: s.role === "admin" ? "admin" : "staff" };
}
