// スタッフ用の管理画面（/admin）の入り方を、画面で確かめる（2026-11-26 オーナー指示「パスワードなしにしてほしい」→「全員無しにする」）。
// ⚠ ローカル専用。ローカルの DB（data/sake-library.db）に、テストのスタッフ「テスト花子」を足し、「長山」に仮のパスワードを入れる。
//   本番の DB につながる設定（TURSO_DATABASE_URL）があるとき・相手が localhost でないときは、何もせずに止まる。
//
// 使い方（このリポの直下で）:
//   1) TURSO_DATABASE_URL を付けずに、開発サーバーを 3888 で動かす:  npx next dev -p 3888
//   2) node scripts/test-staff-login.cjs [画面写真を置くフォルダ]
//        … いまの設定（src/lib/staff-login.ts の PASSWORD_REQUIRED = false）で、名前を押すだけで入れること・保存してあるパスワードは書きかえられないこと（21 項目）
//   3) 「パスワードに戻す」スイッチが効くことまで見るとき: 2) のあと、PASSWORD_REQUIRED を一時的に true にして
//        MODE=pw node scripts/test-staff-login.cjs      （8 項目。終わったら、必ず false に戻す）
//
// Playwright は、このリポの依存には入れていない。クラウドのセッションには最初から入っている（require("playwright")）。
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const root = process.cwd();
const { createClient } = require(path.join(root, "node_modules/@libsql/client"));
const BASE = process.env.BASE || "http://localhost:3888";
if (process.env.TURSO_DATABASE_URL) { console.error("本番の DB につながる設定（TURSO_DATABASE_URL）があるので、止めます"); process.exit(1); }
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) { console.error("相手が localhost ではないので、止めます: " + BASE); process.exit(1); }
const SHOTS = process.argv[2] || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const MODE = process.env.MODE || "nopw";
const NEW = "テスト花子"; // このテストが、ローカルの DB に足すスタッフ
const TEST_PW = "local-test-1234"; // このテストが、ローカルの DB に入れるだけの仮の値（本番のものではない）

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}${detail !== "" ? ` … ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); }
};
let db = null; // サーバーが data/ と DB を作ったあとで開く（下の、最初の読み込みのあと）
const hashes = async () => (await db.execute({ sql: "SELECT name, pass_hash FROM staff WHERE name <> ? ORDER BY id", args: [NEW] })).rows.map((r) => `${r.name}:${String(r.pass_hash).length}:${String(r.pass_hash).slice(0, 6)}`).join("|");

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newCtx = async () => {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, hasTouch: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return { ctx, page };
  };
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png") }); };

  // 表を作らせる・スタッフの種を入れさせる
  const list0 = await (await fetch(`${BASE}/api/admin/login`)).json();
  db = createClient({ url: "file:data/sake-library.db" });
  check("準備: スタッフの名前の一覧が返る（杉本さんは管理者）", Array.isArray(list0.staff) && list0.staff.length >= 4 && list0.staff.some((s) => s.name === "杉本" && s.role === "admin"), list0.staff && list0.staff.map((s) => s.name).join());
  const head = await fetch(`${BASE}/admin/login`);
  check("管理画面は、検索に載せない印が付いている（X-Robots-Tag: noindex）", /noindex/.test(head.headers.get("x-robots-tag") || ""), head.headers.get("x-robots-tag"));

  if (MODE === "nopw") {
    const before = await hashes();
    // ---- 1. 入っていない端末で /admin を開く → ログイン画面。名前だけ・パスワードの欄は無い ----
    const a = await newCtx();
    await a.ctx.addInitScript(() => { try { localStorage.setItem("sksl.staff.auth", JSON.stringify({ name: "長山", pw: "old-saved-value" })); } catch {} });
    await a.page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await a.page.getByRole("button", { name: "長山" }).waitFor({ timeout: 20_000 });
    const t1 = await a.page.locator("main").innerText();
    check("入っていない端末で /admin を開くと、ログイン画面に送られる", new URL(a.page.url()).pathname === "/admin/login", a.page.url());
    check("ログイン画面は、名前だけ（パスワードの欄は無い・「パスワードは要りません」と出る）",
      (await a.page.locator('input[type="password"]').count()) === 0 && t1.includes("パスワードは要りません") && ["杉本", "長山", "細田", "小倉"].every((n) => t1.includes(n)), t1.slice(0, 120));
    check("前の設定でこの端末に保存していたパスワードは、消える", (await a.page.evaluate(() => localStorage.getItem("sksl.staff.auth"))) === null);
    check("自動ログインは、しない（名前を押すまで、ログイン画面のまま）", new URL(a.page.url()).pathname === "/admin/login");
    await shot(a.page, "s1-ログイン画面_名前だけ");
    // ---- 2. スタッフの名前を押す → そのまま在庫ボード ----
    await a.page.getByRole("button", { name: "長山" }).tap();
    await a.page.waitForURL(`${BASE}/admin`, { timeout: 30_000 }).catch(() => {});
    await a.page.getByRole("heading", { name: "在庫ボード" }).waitFor({ timeout: 30_000 }).catch(() => {});
    const t2 = await a.page.locator("body").innerText();
    check("スタッフの名前を押すと、パスワードなしで在庫ボードに入る", new URL(a.page.url()).pathname === "/admin" && t2.includes("在庫ボード"), a.page.url());
    check("在庫ボードに「パスワード変更」は出ない。スタッフには「スタッフ管理」も出ない", !t2.includes("パスワード変更") && !t2.includes("スタッフ管理"), t2.slice(0, 200));
    const ck = (await a.ctx.cookies()).find((c) => c.name === "sksl_staff");
    check("ログインの印（Cookie）が付く（画面のスクリプトからは読めない形）", !!ck && ck.httpOnly === true && /\.staff\./.test(ck.value), ck && { httpOnly: ck.httpOnly });
    const asStaff = await a.page.evaluate(async () => (await fetch("/api/admin/staff")).status);
    check("スタッフは、いままでどおり、スタッフ管理の中身は読めない（管理者だけ）", asStaff === 401, asStaff);
    await shot(a.page, "s2-在庫ボード_スタッフ");
    await a.ctx.close();

    // ---- 3. 管理者（杉本さん）も、名前を押すだけ ----
    const b = await newCtx();
    await b.page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle" });
    await b.page.getByRole("button", { name: /杉本/ }).tap();
    await b.page.getByRole("heading", { name: "在庫ボード" }).waitFor({ timeout: 30_000 }).catch(() => {});
    const t3 = await b.page.locator("body").innerText();
    check("管理者（杉本さん）も、名前を押すだけで入る。「スタッフ管理」が出る", new URL(b.page.url()).pathname === "/admin" && t3.includes("スタッフ管理") && !t3.includes("パスワード変更"), b.page.url());
    await b.page.goto(`${BASE}/admin/staff`, { waitUntil: "networkidle" });
    await b.page.getByRole("heading", { name: "スタッフ管理" }).waitFor({ timeout: 30_000 });
    await b.page.getByText("最終ログイン").first().waitFor({ timeout: 20_000 }).catch(() => {});
    const t4 = await b.page.locator("main").innerText();
    check("スタッフ管理に「パスワード初期化」「初期パスワード」は出ない。「パスワードなしの設定です」と出る",
      !t4.includes("パスワード初期化") && (await b.page.locator('input[placeholder*="パスワード"]').count()) === 0 && t4.includes("パスワードなしの設定です"), t4.slice(0, 160));
    await shot(b.page, "s3-スタッフ管理");
    // 名前だけでスタッフを追加できる
    await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [NEW] });
    await b.page.getByPlaceholder("名前").fill(NEW);
    await b.page.getByRole("button", { name: "追加する" }).tap();
    await b.page.getByText(`${NEW} を追加しました`).waitFor({ timeout: 20_000 }).catch(() => {});
    const row = (await db.execute({ sql: "SELECT pass_hash, role FROM staff WHERE name = ?", args: [NEW] })).rows[0];
    check("名前だけでスタッフを追加できる（パスワードは空のまま入る）", !!row && String(row.pass_hash) === "" && row.role === "staff", row && { len: String(row.pass_hash).length, role: row.role });
    await b.ctx.close();
    // 追加したスタッフも、名前を押すだけで入れる
    const c = await newCtx();
    await c.page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle" });
    await c.page.getByRole("button", { name: NEW }).tap();
    await c.page.getByRole("heading", { name: "在庫ボード" }).waitFor({ timeout: 30_000 }).catch(() => {});
    check("追加したスタッフも、名前を押すだけで入れる", new URL(c.page.url()).pathname === "/admin", c.page.url());
    await c.ctx.close();

    // ---- 4. 名前が無いときは入れない・パスワードは書きかわっていない ----
    const bad = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "いない人" }) });
    const badJ = await bad.json().catch(() => ({}));
    check("一覧に無い名前では入れない（「その名前のスタッフが見つかりません」）", bad.status === 401 && badJ.error === "その名前のスタッフが見つかりません" && !bad.headers.get("set-cookie"), [bad.status, badJ.error]);
    const log = (await db.execute("SELECT payload FROM audit_logs WHERE action = 'staff.login' ORDER BY id DESC LIMIT 1")).rows[0];
    check("記録（audit_logs）に、パスワードなしで入った印（nopw）が残る", !!log && /"nopw":true/.test(String(log.payload)), log && String(log.payload));

    // ---- 5. パスワードなしのあいだは、保存してあるパスワードを書きかえられない（だれでも入れるあいだに書きかえられると、戻したときに入れなくなる）----
    const d = await newCtx();
    await d.page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle" });
    await d.page.getByRole("button", { name: /杉本/ }).tap();
    await d.page.getByRole("heading", { name: "在庫ボード" }).waitFor({ timeout: 30_000 }).catch(() => {});
    const nagayama = (await db.execute("SELECT id FROM staff WHERE name = '長山'")).rows[0];
    const call = (url, method, body) => d.page.evaluate(async ([url, method, body]) => { const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return r.status; }, [url, method, body]);
    const reset = await call("/api/admin/staff", "PATCH", { id: Number(nagayama.id), password: TEST_PW });
    const change = await call("/api/admin/change-password", "POST", { current: "x", newPassword: TEST_PW });
    check("管理者として入っても、スタッフのパスワードは入れ直せない（409）。自分のパスワードも変えられない（409）", reset === 409 && change === 409, [reset, change]);
    const role = await call("/api/admin/staff", "PATCH", { id: Number(nagayama.id), role: "staff" });
    check("権限の変更などは、いままでどおりできる", role === 200, role);
    await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [NEW + "2"] });
    const add2 = await call("/api/admin/staff", "POST", { name: NEW + "2", password: TEST_PW });
    const row2 = (await db.execute({ sql: "SELECT pass_hash FROM staff WHERE name = ?", args: [NEW + "2"] })).rows[0];
    check("追加のときにパスワードを送っても、入れない（空のまま）", add2 === 200 && !!row2 && String(row2.pass_hash) === "", [add2, row2 && String(row2.pass_hash).length]);
    await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [NEW + "2"] });
    await d.ctx.close();
    const after = await hashes();
    check("ここまでで、もとのスタッフのパスワード（DB）は、1 つも書きかわっていない（パスワードに戻したとき、前のものが使える）", after === before);
  } else {
    // ---- 「パスワードに戻した」状態（PASSWORD_REQUIRED = true）: 前の画面・前の動きに戻る ----
    // 準備: 「長山」に、このテストだけの仮のパスワードを入れる（ローカルの DB に直接。ハッシュの作り方は src/lib/auth.ts の hashPassword と同じ）
    const hash = require("crypto").createHash("sha256").update("sksl.staff.v1:" + TEST_PW).digest("hex");
    await db.execute({ sql: "UPDATE staff SET pass_hash = ? WHERE name = '長山'", args: [hash] });
    const a = await newCtx();
    await a.page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await a.page.getByRole("button", { name: "長山" }).waitFor({ timeout: 20_000 });
    await a.page.getByRole("button", { name: "長山" }).tap();
    await a.page.locator('input[type="password"]').waitFor({ timeout: 10_000 }).catch(() => {});
    check("戻したとき: 名前を押すと、パスワードの欄が出る（名前だけでは入れない）", (await a.page.locator('input[type="password"]').count()) === 1 && new URL(a.page.url()).pathname === "/admin/login");
    await a.page.locator('input[type="password"]').fill("wrong-value");
    await a.page.getByRole("button", { name: "入る" }).tap();
    await a.page.getByText("名前またはパスワードが違います").waitFor({ timeout: 10_000 }).catch(() => {});
    check("戻したとき: ちがうパスワードでは入れない", (await a.page.getByText("名前またはパスワードが違います").count()) === 1 && new URL(a.page.url()).pathname === "/admin/login");
    await a.page.locator('input[type="password"]').fill(TEST_PW);
    await a.page.getByRole("button", { name: "入る" }).tap();
    await a.page.getByRole("heading", { name: "在庫ボード" }).waitFor({ timeout: 30_000 }).catch(() => {});
    const t = await a.page.locator("body").innerText();
    check("戻したとき: 合っているパスワードで入れる。「パスワード変更」が出る", new URL(a.page.url()).pathname === "/admin" && t.includes("パスワード変更"), a.page.url());
    await a.ctx.close();
    const noName = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "長山" }) });
    check("戻したとき: 名前だけの送信では入れない", noName.status === 401, noName.status);
    const empty = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "テスト花子", password: "" }) });
    const empty2 = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "テスト花子", password: TEST_PW }) });
    check("戻したとき: パスワードなしのあいだに追加したスタッフ（空のまま）は、入れない（管理者が入れ直すまで）", empty.status === 401 && empty2.status === 401, [empty.status, empty2.status]);
  }

  check("画面のエラーが無い", errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
