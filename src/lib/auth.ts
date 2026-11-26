import { createHash, createHmac, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { all, get, run } from "./db";
import { PASSWORD_REQUIRED } from "./staff-login";

export const STAFF_COOKIE = "sksl_staff";

export function hashPassword(pw: string): string {
  return createHash("sha256").update("sksl.staff.v1:" + pw).digest("hex");
}

export type StaffSession = { id: number; role: "admin" | "staff" };

// ---- ログインの印（Cookie sksl_staff）----
// 形: 「種類.スタッフID.権限.署名」。種類は、その印を出したときの設定（src/lib/staff-login.ts の PASSWORD_REQUIRED）:
//   nopw … パスワードなしの設定で出した印 ／ pw2 … パスワードありの設定で出した印
// いまの設定とちがう種類の印は、受け付けない＝パスワードに戻した瞬間に、無しのあいだに出した印は、すべて使えなくなる
// （2026-11-26 レビュー指摘: 前は、戻したあとも、無しのあいだに取った印で管理者として入れた。印には出した時期の区別が無く、
// ログアウトの口も無かった）。
//
// 前の形（「ID.権限.署名」の 3 つ組。この直しより前の版が出していた。90 日もつ）:
//   パスワードありの設定 … 受け付けない（戻したら、全員、パスワードで入り直す）
//   パスワードなしの設定 … 署名を見ずに、受け付ける。この直しを出した瞬間に、スタッフの端末の印がすべて使えなくなると、
//     開きっぱなしの在庫ボードで「売切」を押しても戻ってしまう（営業中に出すと、売切が付かない）。無しのあいだは、名前を押せば
//     だれでも入れる＝印は何も守っていないので、前の形をそのまま通しても、できることは増えない。
//     署名を確かめないのは、前の署名の鍵が ADMIN_PASSWORD そのものだったから（下の「署名の鍵」。もう使わない）。
//     前の形の印は、2027-03 には、すべて期限が切れる。そのあとは、この枝（LEGACY_OK）を消してよい
//
// 署名の鍵:
//   nopw … 決まった文字（OPEN_KEY。秘密ではない）。ADMIN_PASSWORD は使わない。
//          無しのあいだは、だれでも印をもらえる。そこに ADMIN_PASSWORD で作った署名を付けると、印 1 つで、ADMIN_PASSWORD の
//          当て推量を手元で 1 秒に何十万回も試せてしまう（レビュー指摘）。入口が開いているあいだ、印の署名は何も守っていないので、秘密を使わない
//   pw2  … STAFF_COOKIE_SECRET（Vercel の env。入れてあれば）。無ければ ADMIN_PASSWORD。どちらも、そのまま鍵にはせず、
//          時間のかかる計算（scrypt）を通した値を鍵にする（印から当て推量を試すのに、1 回ごとに時間がかかるようにする）
const KIND = PASSWORD_REQUIRED ? "pw2" : "nopw";
/** 前の形（3 つ組）の印を通すか。パスワードなしの設定のあいだだけ（パスワードありでは、必ず false） */
const LEGACY_OK = !PASSWORD_REQUIRED;
const OPEN_KEY = "sksl.staff.nopw.v1";
let _pwKey: { from: string; key: Buffer } | null = null;
function pwKey(): Buffer {
  const secret = process.env.STAFF_COOKIE_SECRET || "";
  const from = secret ? `s:${secret}` : `p:${process.env.ADMIN_PASSWORD || "sugidama-dev-key"}`;
  if (!_pwKey || _pwKey.from !== from) _pwKey = { from, key: scryptSync(from, "sksl.staff.cookie.v2", 32) };
  return _pwKey.key;
}
function mac(body: string): string {
  return createHmac("sha256", PASSWORD_REQUIRED ? pwKey() : OPEN_KEY).update(body).digest("base64url");
}

export function signStaff(id: number, role: string): string {
  const body = `${KIND}.${id}.${role}`;
  return `${body}.${mac(body)}`;
}
export function verifyStaffCookie(cookie?: string): StaffSession | null {
  if (!cookie) return null;
  const parts = cookie.split(".");
  // 前の形（3 つ組）: パスワードなしの設定のあいだだけ、署名を見ずに通す（上の説明）。パスワードありでは、受け付けない
  if (parts.length === 3) return LEGACY_OK ? toSession(parts[0], parts[1]) : null;
  if (parts.length !== 4) return null;
  const [kind, idStr, role, sig] = parts;
  if (kind !== KIND) return null;      // いまの設定とちがう種類の印
  const want = Buffer.from(mac(`${kind}.${idStr}.${role}`));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return toSession(idStr, role);
}
function toSession(idStr: string, role: string): StaffSession | null {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0 || (role !== "admin" && role !== "staff")) return null;
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

// 初回のみ（スタッフの表が空のとき）4 名を入れる。
// 2026-11-26: パスワードは、入れない（空）。前は、杉本以外に、決まった仮パスワードを入れていた。このリポは公開なので、
// その値はだれでも読める＝表が空になって入れ直されると、パスワードありの設定で、その 3 人として入れてしまう（レビュー指摘）。
// 空のスタッフは、パスワードありの設定では入れない（管理者がスタッフ管理の「パスワード初期化」で入れる）。
// 管理者（杉本）だけは、Vercel の ADMIN_PASSWORD（8 文字以上）があれば、その値を入れる（無ければ空。入れ直せば、その値で入れる＝ownerRecoveryMatches）
export async function ensureStaffSeed(): Promise<void> {
  const cnt = await get<{ n: number }>("SELECT COUNT(*) AS n FROM staff");
  if (cnt && Number(cnt.n) > 0) return;
  const env = process.env.ADMIN_PASSWORD || "";
  const seed: [string, string, "admin" | "staff"][] = [
    ["杉本", env.length >= 8 ? hashPassword(env) : "", "admin"],
    ["長山", "", "staff"],
    ["細田", "", "staff"],
    ["小倉", "", "staff"],
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
  // パスワードなし（PASSWORD_REQUIRED = false。2026-11-26 オーナー指示）のあいだは、名前が合えば入れる。
  // パスワードは見ない・書きかえない（戻したときに、前のパスワードがそのまま使えるように）
  if (PASSWORD_REQUIRED && (!s.pass_hash || s.pass_hash !== hashPassword(password))) {
    // 管理者がパスワードを忘れたときの復旧（2026-11-18）。他のスタッフは管理者が戻せるが、管理者本人は戻す人がいない。
    // Vercel の ADMIN_PASSWORD を新しい値に入れ直す → その値で管理者としてログインでき、以後のパスワードもその値になる。
    // env を書き換えられるのは Vercel に入れる人だけ。env が未設定・短すぎる（8 文字未満）ときは使えない（開発既定値では通さない）。
    if (!ownerRecoveryMatches(s.role, password)) return null;
    await run("UPDATE staff SET pass_hash = ? WHERE id = ?", [hashPassword(password), s.id]);
  }
  await run("UPDATE staff SET last_login = datetime('now','localtime') WHERE id = ?", [s.id]);
  return { id: s.id, role: s.role === "admin" ? "admin" : "staff" };
}
