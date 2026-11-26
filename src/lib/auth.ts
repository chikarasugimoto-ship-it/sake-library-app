import { createHash, createHmac, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { all, get, run } from "./db";
import { PASSWORD_REQUIRED } from "./staff-login";

export const STAFF_COOKIE = "sksl_staff";

// 2 つの文字列を、長さのちがいで時間差が出ないように比べるための、短い印（sha256）。
// ⚠ パスワードの保存には使わない。前はこれをそのまま DB に入れていた（鍵なし）。いまの保存の形は、下の passwordHashFor
function sha256Pw(pw: string): string {
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
//          本番で、どちらの env も無いときは、鍵を作らない＝印を出さない・受け付けない（開発用の決まった値は、このリポが公開なので
//          だれでも読める。それで署名すると、だれでも管理者の印を作れてしまう。2026-11-26 レビュー指摘）
const KIND = PASSWORD_REQUIRED ? "pw2" : "nopw";
/** 前の形（3 つ組）の印を通すか。パスワードなしの設定のあいだだけ（パスワードありでは、必ず false） */
const LEGACY_OK = !PASSWORD_REQUIRED;
const OPEN_KEY = "sksl.staff.nopw.v1";
let _pwKey: { from: string; key: Buffer } | null = null;
/** パスワードありの印の鍵。null = 作れない（本番で env が 1 つも無い） */
function pwKey(): Buffer | null {
  const secret = process.env.STAFF_COOKIE_SECRET || "";
  const admin = process.env.ADMIN_PASSWORD || "";
  if (!secret && !admin && process.env.NODE_ENV === "production") return null;
  const from = secret ? `s:${secret}` : `p:${admin || "sugidama-dev-key"}`;
  if (!_pwKey || _pwKey.from !== from) _pwKey = { from, key: scryptSync(from, "sksl.staff.cookie.v2", 32) };
  return _pwKey.key;
}
/** 署名。null = 署名できない（鍵が無い） */
function mac(body: string): string | null {
  const key = PASSWORD_REQUIRED ? pwKey() : OPEN_KEY;
  return key == null ? null : createHmac("sha256", key).update(body).digest("base64url");
}

export function signStaff(id: number, role: string): string {
  const body = `${KIND}.${id}.${role}`;
  const sig = mac(body);
  if (sig == null) throw new Error("STAFF_COOKIE_SECRET か ADMIN_PASSWORD が要ります（本番では、開発用の鍵でログインの印を作らない）");
  return `${body}.${sig}`;
}
// ---- パスワードの保存の形（パスワードありの設定のときだけ使う）----
// 形: 「k2.」＋ HMAC(鍵, 名前とパスワード)。鍵は、ログインの印（pw2）と同じもと（STAFF_COOKIE_SECRET、無ければ ADMIN_PASSWORD）から作る。
//
// なぜ、鍵を入れるか（2026-11-27。4fd1102 のレビューの指摘 1〜3 を、根本から直した）:
//   パスワードなしのあいだは、だれでも管理者として入れた。古いデプロイ（古いコードのまま、同じ DB で動く）は、
//   前の形の印を受け付け、パスワードの入れ直しもできる。そこで入れられたパスワードを、戻したあとで通してはいけない。
//   前の直しは「戻した最初のログインで、全員のパスワードを空にする」だった。これには穴があった:
//     ・空にしたあと、古いデプロイを消すまでのあいだに、古いデプロイからパスワードを入れ直せる（レビューで実際にできた）
//     ・「もう空にした」の印が DB に 1 つだけ＝プレビューのデプロイなどが先に踏むと、本番に戻したときには空にならない
//     ・ADMIN_PASSWORD が無い・短いときも空にしてしまい、だれも入れなくなる
//   いまの形は、**何も消さない**。「いまの鍵で作ったもの」だけを通す:
//     ・前の形（鍵なしの sha256）のパスワードは、どれも通らない＝戻したら、全員、入れ直しになる（空にしたのと同じ結果）
//     ・古いデプロイ・前の形のコードが書いたパスワードは、いつ書かれても通らない（鍵を知らないので、この形を作れない）
//     ・鍵のもとを入れ替えると、ログインの印もパスワードも、まとめて無効になる（＝全員を締め出して、やり直す手段）
//   名前を入れているのは、同じパスワードの人どうしで、保存した値が同じにならないようにするため。
//   ⚠ 名前を変える機能を足すときは、変えた人のパスワードを入れ直すこと（保存した値が合わなくなる）
const PW_PREFIX = "k2.";
/** パスワードを保存する形にする。null = 作れない（本番で env が 1 つも無い） */
export function passwordHashFor(name: string, password: string): string | null {
  const base = pwKey();
  if (base == null) return null;
  const key = createHmac("sha256", base).update("sksl.staff.pwhash.key.v2").digest(); // 印の署名とは別の鍵にする
  return PW_PREFIX + createHmac("sha256", key).update(`sksl.staff.pw.v2\n${name}\n${password}`).digest("base64url");
}
/** 保存してある値と、入力が合うか。前の形・空・鍵がちがうものは、合わない */
export function passwordMatches(name: string, stored: string, password: string): boolean {
  if (!stored || !stored.startsWith(PW_PREFIX) || !password) return false;
  const want = passwordHashFor(name, password);
  if (want == null) return false;
  const a = Buffer.from(want), b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** いまの形のパスワードが入っているか（中身が合うかは見ない。「まだ入っていません」の案内に使う） */
const hasNewPassword = (stored: string) => !!stored && stored.startsWith(PW_PREFIX);
/** パスワードありの設定で、ログインの印を出せるか（本番で env が 1 つも無いと、出せない） */
export function canIssuePasswordSession(): boolean {
  return pwKey() != null;
}

export function verifyStaffCookie(cookie?: string): StaffSession | null {
  if (!cookie) return null;
  const parts = cookie.split(".");
  // 前の形（3 つ組）: パスワードなしの設定のあいだだけ、署名を見ずに通す（上の説明）。パスワードありでは、受け付けない
  if (parts.length === 3) return LEGACY_OK ? toSession(parts[0], parts[1]) : null;
  if (parts.length !== 4) return null;
  const [kind, idStr, role, sig] = parts;
  if (kind !== KIND) return null;      // いまの設定とちがう種類の印
  const expected = mac(`${kind}.${idStr}.${role}`);
  if (expected == null) return null;   // 鍵が無い（本番で env が無い）→ どの印も受け付けない
  const want = Buffer.from(expected);
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
// 管理者（杉本）も空で入れる（2026-11-27）。パスワードありの設定では、Vercel の ADMIN_PASSWORD（8 文字以上）の値で入れて、
// そのとき、いまの形で保存される（ownerRecoveryMatches）
export async function ensureStaffSeed(): Promise<void> {
  const cnt = await get<{ n: number }>("SELECT COUNT(*) AS n FROM staff");
  if (cnt && Number(cnt.n) > 0) return;
  const seed: [string, string, "admin" | "staff"][] = [
    ["杉本", "", "admin"],
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
  return timingSafeEqual(Buffer.from(sha256Pw(password)), Buffer.from(sha256Pw(env)));
}

// （2026-11-27: 「パスワードに戻した最初の 1 回だけ、全員のパスワードを空にする」は、やめた。理由と、代わりの仕組みは、上の「パスワードの保存の形」）

/** ログインの結果。setup = 設定が終わっていなくて、だれも入れない（Vercel の env を直す）／ hint = この人が入れない理由の案内 */
export type StaffLoginResult = { ok: true; session: StaffSession } | { ok: false; setup?: string; hint?: string };
export const LOGIN_SETUP_NO_KEY = "ログインの準備が、まだ終わっていません。Vercel に ADMIN_PASSWORD（8 文字以上）と STAFF_COOKIE_SECRET を入れて、デプロイし直してください。";
export const LOGIN_SETUP_ADMIN = "管理者のパスワードが、まだ入っていません。Vercel の ADMIN_PASSWORD（8 文字以上）を入れて、デプロイし直すと、その値で入れます。";
export const LOGIN_HINT_STAFF = "この名前には、まだパスワードが入っていません。管理者に、スタッフ管理の「パスワード初期化」をしてもらってください。";

export async function verifyStaffLogin(name: string, password: string): Promise<StaffLoginResult> {
  await ensureStaffSeed();
  // パスワードありの設定で、本番に env が 1 つも無いときは、ログインの印を作れない＝だれも入れない。
  // DB に何も書かないうちに、そう伝える（前は、パスワードが合ったあとで 500 になり、「入った」の記録だけが残った。レビューの指摘 5）
  if (PASSWORD_REQUIRED && !canIssuePasswordSession()) return { ok: false, setup: LOGIN_SETUP_NO_KEY };
  const s = await get<StaffRow>("SELECT id, name, pass_hash, role FROM staff WHERE name = ?", [name]);
  if (!s) return { ok: false };
  // パスワードなし（PASSWORD_REQUIRED = false。2026-11-26 オーナー指示）のあいだは、名前が合えば入れる。
  // パスワードは見ない・書きかえない
  if (PASSWORD_REQUIRED && !passwordMatches(s.name, s.pass_hash, password)) {
    // 管理者がパスワードを忘れたときの復旧（2026-11-18）・パスワードに戻したあとの、管理者の最初の入口。
    // Vercel の ADMIN_PASSWORD の値で管理者としてログインでき、以後のパスワードもその値になる（いまの形で保存する）。
    // env を書き換えられるのは Vercel に入れる人だけ。env が未設定・短すぎる（8 文字未満）ときは使えない（開発既定値では通さない）。
    if (!ownerRecoveryMatches(s.role, password)) {
      if (hasNewPassword(s.pass_hash)) return { ok: false };
      // いまの形のパスワードが、まだ入っていない人（パスワードに戻した直後は、全員こうなる）。入れない理由を伝える
      if (s.role === "admin") return (process.env.ADMIN_PASSWORD || "").length >= 8 ? { ok: false } : { ok: false, setup: LOGIN_SETUP_ADMIN };
      return { ok: false, hint: LOGIN_HINT_STAFF };
    }
    const h = passwordHashFor(s.name, password);
    if (h == null) return { ok: false, setup: LOGIN_SETUP_NO_KEY };
    await run("UPDATE staff SET pass_hash = ? WHERE id = ?", [h, s.id]);
  }
  await run("UPDATE staff SET last_login = datetime('now','localtime') WHERE id = ?", [s.id]);
  return { ok: true, session: { id: s.id, role: s.role === "admin" ? "admin" : "staff" } };
}
