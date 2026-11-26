// スタッフ用の管理画面（/admin）の入り方を、画面で確かめる（2026-11-26 オーナー指示「パスワードなしにしてほしい」→「全員無しにする」）。
// ⚠ ローカル専用。ローカルの DB（data/sake-library.db）に、テストのスタッフ「テスト花子」を足し、「長山」に仮のパスワードを入れる。
//   本番の DB につながる設定（TURSO_DATABASE_URL）があるとき・相手が localhost でないときは、何もせずに止まる。
//
// 使い方（このリポの直下で）:
//   1) TURSO_DATABASE_URL を付けずに、ビルドして、3888 で動かす:  npm run build && npx next start -p 3888
//        （next dev でも回るが、DB への書きこみのたびに作り直しが走り、まれに 500 が混ざる。ビルドしたほうが確か）
//   2) node scripts/test-staff-login.cjs [画面写真を置くフォルダ]
//        … いまの設定（src/lib/staff-login.ts の PASSWORD_REQUIRED = false）で、名前を押すだけで入れること・保存してあるパスワードは
//          書きかえられないこと・ログインの印の形・口の返事（31 項目。FRESH=1 のときは 32 項目。data/sake-library.db を消してから始めたときは FRESH=1 を付けると、種の確かめも回る＝32 項目）
//   3) 「パスワードに戻す」スイッチが効くことまで見るとき:  node scripts/test-staff-pwmode.cjs
//        このフォルダを書きかえずに、一時のコピーの PASSWORD_REQUIRED を true にしてビルドし、サーバーを立て直しながら確かめる。
//        その中で、このスクリプトを MODE=pw で、一時のコピーに向けて回す（MODE=pw を手で回すことは、ふつう無い）
//
// 書きこむ前に、サーバーが「このフォルダのローカルの DB」を見ていることを確かめる（目印の行を DB に直接入れて、サーバーの一覧に出るかを見る）。
// サーバーが別の DB（本番の Turso など）を見ていたら、何も書かずに止まる（2026-11-26 レビュー指摘）。
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
const crypto = require("crypto");
const hmac = (key, body) => crypto.createHmac("sha256", key).update(body).digest("base64url");
/** 印（Cookie）を付けて、管理者だけの口（スタッフの一覧）を叩く。200 = 管理者として通った ／ 401 = 通らない */
const tryCookie = async (value) => (await fetch(`${BASE}/api/admin/staff`, { headers: { cookie: `sksl_staff=${value}` } })).status;
/** 印を付けて、スタッフならだれでも読める口（設定）を叩く。200 = スタッフとして通った ／ 401 = 通らない */
const tryStaffCookie = async (value) => (await fetch(`${BASE}/api/admin/settings`, { headers: { cookie: `sksl_staff=${value}` } })).status;
/** 前の形（ID.権限.署名）の印。開発用の鍵（env が無いときの決まった値）で、正しく署名したもの。値は、ソースから読む（ここに書き写さない） */
const legacyCookie = (id) => {
  const m = /\$\{admin \|\| "([^"]+)"\}/.exec(fs.readFileSync(path.join(root, "src/lib/auth.ts"), "utf-8"));
  return m ? `${id}.admin.${hmac(m[1], `${id}.admin`)}` : "";
};
/** パスワードなしの設定の印。鍵は、公開してよい決まった文字（src/lib/auth.ts の OPEN_KEY） */
const nopwCookie = (id) => `nopw.${id}.admin.${hmac("sksl.staff.nopw.v1", `nopw.${id}.admin`)}`;
/** 種類だけ pw2 にして、公開の鍵で「正しく」署名した印（＝種類の見分け・鍵の使い分けが抜けていると、通ってしまう印） */
const pw2ByOpenKey = (id) => `pw2.${id}.admin.${hmac("sksl.staff.nopw.v1", `pw2.${id}.admin`)}`;
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
  // サーバーが、このフォルダのローカルの DB を見ているか（目印の行を直接入れて、サーバーの一覧に出るかを見る）。出なければ、何も書かずに止まる
  const MARK = "目印" + crypto.randomBytes(4).toString("hex");
  await db.execute({ sql: "INSERT INTO staff (name, pass_hash, role) VALUES (?, '', 'staff')", args: [MARK] });
  const seen = await (await fetch(`${BASE}/api/admin/login`)).json().catch(() => ({}));
  await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [MARK] });
  if (!Array.isArray(seen.staff) || !seen.staff.some((x) => x.name === MARK)) {
    console.error("サーバーが、このフォルダのローカルの DB（data/sake-library.db）を見ていません。何も書かずに止めます");
    process.exit(1);
  }
  const ownerId = Number((await db.execute("SELECT id FROM staff WHERE role = 'admin' ORDER BY id LIMIT 1")).rows[0].id);
  check("準備: スタッフの名前の一覧が返る（杉本さんは管理者）", Array.isArray(list0.staff) && list0.staff.length >= 4 && list0.staff.some((s) => s.name === "杉本" && s.role === "admin"), list0.staff && list0.staff.map((s) => s.name).join());
  const head = await fetch(`${BASE}/admin/login`);
  check("管理画面は、検索に載せない印が付いている（X-Robots-Tag: noindex）", /noindex/.test(head.headers.get("x-robots-tag") || ""), head.headers.get("x-robots-tag"));

  if (MODE === "nopw") {
    const before = await hashes();
    if (process.env.FRESH) {
      const seed = (await db.execute("SELECT name, pass_hash FROM staff ORDER BY id")).rows;
      check("スタッフの種（最初の 4 人）は、パスワードが空で入る（公開されている仮パスワードを入れない）", seed.length === 4 && seed.every((r) => String(r.pass_hash) === ""), seed.map((r) => `${r.name}:${String(r.pass_hash).length}`).join());
    }
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
    check("ログインの印（Cookie）が付く（画面のスクリプトからは読めない形。種類は nopw）", !!ck && ck.httpOnly === true && /^nopw\.\d+\.staff\.[\w-]+$/.test(ck.value), ck && { httpOnly: ck.httpOnly, head: ck.value.split(".").slice(0, 3).join(".") });
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
    // ---- 6. ログインの印の形 ----
    // 前の形（ID.権限.署名）の印: パスワードなしのあいだは、そのまま使える（この直しを出した瞬間に、開いている在庫ボードが止まらないように）。
    // 本番の端末にある印は、本番の ADMIN_PASSWORD で署名されている。ここでは、その代わりに「知らない鍵で署名した印」を使う（署名は見ない）
    const legacy = legacyCookie(ownerId);
    const legacyStaff = `${Number(nagayama.id)}.staff.${hmac("some-other-key", `${Number(nagayama.id)}.staff`)}`;
    const legacySeen = [legacy ? await tryCookie(legacy) : 0, await tryStaffCookie(legacyStaff), await tryCookie(legacyStaff), await tryCookie(`${ownerId}.owner.x`), await tryCookie(`0.admin.x`)];
    check("前の形（ID.権限.署名）の印は、パスワードなしのあいだは、そのまま使える（スタッフの印は、スタッフのまま。形のおかしい印は通らない）",
      legacySeen.join() === "200,200,401,401,401", legacySeen);
    const e = await newCtx();
    await e.ctx.addCookies([{ name: "sksl_staff", value: legacyStaff, url: BASE }]);
    await e.page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await e.page.getByRole("heading", { name: "在庫ボード" }).waitFor({ timeout: 30_000 }).catch(() => {});
    check("前の形の印が残っている端末は、入り直さずに、そのまま在庫ボードが開く", new URL(e.page.url()).pathname === "/admin" && (await e.page.locator("body").innerText()).includes("在庫ボード"), e.page.url());
    await e.ctx.close();
    const kinds = [await tryCookie(nopwCookie(ownerId)), await tryCookie(pw2ByOpenKey(ownerId)), await tryCookie(nopwCookie(ownerId).slice(0, -4) + "AAAA"), await tryCookie("")];
    check("パスワードなしの設定の印（nopw）は、受け付ける。種類が pw2 の印（署名は公開の鍵で合っている）・署名が合わない印・空の印は、受け付けない",
      kinds.join() === "200,401,401,401", kinds);
    // ---- 7. 最後の管理者は消せない ----
    const d2 = await newCtx();
    await d2.page.goto(`${BASE}/admin/login`, { waitUntil: "networkidle" });
    await d2.page.getByRole("button", { name: /杉本/ }).tap();
    await d2.page.getByRole("heading", { name: "在庫ボード" }).waitFor({ timeout: 30_000 }).catch(() => {});
    const delOwner = await d2.page.evaluate(async (id) => (await fetch("/api/admin/staff", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })).status, ownerId);
    const admins = Number((await db.execute("SELECT COUNT(*) AS n FROM staff WHERE role = 'admin'")).rows[0].n);
    check("最後の管理者は、消せない（409。管理者は 1 人のまま）", delOwner === 409 && admins === 1, [delOwner, admins]);
    await d2.ctx.close();
    // 2 つの依頼が同時に届くと、手前の数え方（管理者は何人か）を 2 つとも通り抜けることがある（本番の DB は、1 文ごとに通信をはさむ）。
    // そのときに止めるのは、消す SQL そのもの。ローカルの SQLite では依頼が途中で入れかわらないので、口が流す SQL をソースから読んで、DB に直接流して見る
    const delSql = (/"(DELETE FROM staff WHERE id = \?[^"]*)"/.exec(fs.readFileSync(path.join(root, "src/app/api/admin/staff/route.ts"), "utf-8")) || [])[1] || "";
    const ownerRow = (await db.execute({ sql: "SELECT id, name, pass_hash, role, created_at, last_login FROM staff WHERE id = ?", args: [ownerId] })).rows[0];
    const putOwnerBack = () => db.execute({ sql: "INSERT INTO staff (id, name, pass_hash, role, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING", args: [ownerRow.id, ownerRow.name, ownerRow.pass_hash, ownerRow.role, ownerRow.created_at, ownerRow.last_login] });
    const adminsNow = async () => Number((await db.execute("SELECT COUNT(*) AS n FROM staff WHERE role = 'admin'")).rows[0].n);
    const ADM2 = NEW + "管理";
    await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [ADM2] });
    const lone = delSql ? Number((await db.execute({ sql: delSql, args: [ownerId] })).rowsAffected) : -1; // 管理者が 1 人だけ → 消えない（0 行）
    const loneLeft = await adminsNow();
    await putOwnerBack();
    await db.execute({ sql: "INSERT INTO staff (name, pass_hash, role) VALUES (?, '', 'admin')", args: [ADM2] });
    const adm2Id = Number((await db.execute({ sql: "SELECT id FROM staff WHERE name = ?", args: [ADM2] })).rows[0].id);
    const first = delSql ? Number((await db.execute({ sql: delSql, args: [adm2Id] })).rowsAffected) : -1;  // 管理者が 2 人 → 1 人めは消せる（1 行）
    const second = delSql ? Number((await db.execute({ sql: delSql, args: [ownerId] })).rowsAffected) : -1; // 続けてもう 1 人 → 消えない（0 行）
    const bothLeft = await adminsNow();
    await putOwnerBack();
    await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [ADM2] });
    check("消す SQL そのものが、最後の管理者を消さない（手前の数え方を 2 つの依頼が同時に通り抜けても、管理者は 0 人にならない）",
      lone === 0 && loneLeft === 1 && first === 1 && second === 0 && bothLeft === 1, { lone, loneLeft, first, second, bothLeft, sql: delSql ? "読めた" : "読めなかった" });
    // 「最後の管理者を一般に下げない」も、書きかえる SQL そのもので見る（消す SQL と同じ理由）
    const roleSql = (/"(UPDATE staff SET role = \?[^"]*)"/.exec(fs.readFileSync(path.join(root, "src/app/api/admin/staff/route.ts"), "utf-8")) || [])[1] || "";
    const roleOf = async (id) => String((await db.execute({ sql: "SELECT role FROM staff WHERE id = ?", args: [id] })).rows[0]?.role);
    const demote = async (id) => (roleSql ? Number((await db.execute({ sql: roleSql, args: ["staff", id, "staff"] })).rowsAffected) : -1);
    const dLone = await demote(ownerId);                                   // 管理者が 1 人だけ → 下がらない（0 行）
    const dLoneRole = await roleOf(ownerId);
    await db.execute({ sql: "UPDATE staff SET role = 'admin' WHERE id = ?", args: [ownerId] });
    await db.execute({ sql: "INSERT INTO staff (name, pass_hash, role) VALUES (?, '', 'admin')", args: [ADM2] });
    const adm2b = Number((await db.execute({ sql: "SELECT id FROM staff WHERE name = ?", args: [ADM2] })).rows[0].id);
    const dFirst = await demote(adm2b);                                    // 管理者が 2 人 → 1 人めは下げられる（1 行）
    const dSecond = await demote(ownerId);                                 // 続けてもう 1 人 → 下がらない（0 行）
    const dAdmins = await adminsNow();
    const promote = roleSql ? Number((await db.execute({ sql: roleSql, args: ["admin", adm2b, "admin"] })).rowsAffected) : -1; // 上げるのは、いつでもできる
    await db.execute({ sql: "UPDATE staff SET role = 'admin' WHERE id = ?", args: [ownerId] });
    await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [ADM2] });
    check("下げる SQL そのものが、最後の管理者を一般に下げない（2 人を同時に下げても、管理者は 0 人にならない）。上げるのは、できる",
      dLone === 0 && dLoneRole === "admin" && dFirst === 1 && dSecond === 0 && dAdmins === 1 && promote === 1, { dLone, dLoneRole, dFirst, dSecond, dAdmins, promote, sql: roleSql ? "読めた" : "読めなかった" });
    // ---- 8. 口の返事: id の無い依頼・書けなかったとき（0 行）・同時に消されていたとき ----
    //  「最後の管理者を守る」は SQL の中でやっている（上の 2 つ）。ここでは、口（route）が「書けた行の数」を見て、正しく返事をしているかを見る。
    //  ローカルの SQLite では依頼が途中で入れかわらないので、DB の仕掛け（トリガー）で「書けなかった」「読んだあとで行が消えた」を作る
    const adminCk = `sksl_staff=${nopwCookie(ownerId)}`;
    const api = (method, body) => fetch(`${BASE}/api/admin/staff`, { method, headers: { "Content-Type": "application/json", cookie: adminCk }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
    const noId = [(await api("PATCH", { role: "staff" })).status, (await api("DELETE", {})).status, (await api("PATCH", { id: "abc", role: "staff" })).status, (await api("DELETE", { id: 0 })).status];
    check("id の無い・おかしい依頼は 400（前は、形によって 404 か 500）", noId.join() === "400,400,400,400", noId);
    const sameRole = await api("PATCH", { id: ownerId, role: "admin" });
    check("ただ 1 人の管理者を、管理者のままにする依頼は通る（200。守りが、上げる依頼まで止めていない）", sameRole.status === 200 && (await adminsNow()) === 1, [sameRole.status, await adminsNow()]);
    const TMP = NEW + "仮";
    const mkTmp = async () => { await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [TMP] }); await db.execute({ sql: "INSERT INTO staff (name, pass_hash, role) VALUES (?, '', 'staff')", args: [TMP] }); return Number((await db.execute({ sql: "SELECT id FROM staff WHERE name = ?", args: [TMP] })).rows[0].id); };
    const drop = async () => { for (const t of ["t_skip_role", "t_skip_del", "t_gone_upd", "t_gone_del"]) await db.execute(`DROP TRIGGER IF EXISTS ${t}`); };
    const roleLogs = async () => Number((await db.execute("SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('staff.role','staff.delete')")).rows[0].n);
    await drop();
    let tmpId = await mkTmp();
    const logs0 = await roleLogs();
    await db.execute("CREATE TRIGGER t_skip_role BEFORE UPDATE OF role ON staff BEGIN SELECT RAISE(IGNORE); END");
    const skipRole = await api("PATCH", { id: tmpId, role: "admin" });
    await drop();
    await db.execute("CREATE TRIGGER t_skip_del BEFORE DELETE ON staff BEGIN SELECT RAISE(IGNORE); END");
    const skipDel = await api("DELETE", { id: tmpId });
    await drop();
    check("書けなかったとき（0 行）は、409 を返す。「変えた」「消した」と言わない・記録も付けない（行は、そのまま）",
      skipRole.status === 409 && skipDel.status === 409 && (await roleOf(tmpId)) === "staff" && (await roleLogs()) === logs0, { skipRole: skipRole.status, skipDel: skipDel.status, role: await roleOf(tmpId), logs: [(await roleLogs()), logs0] });
    await db.execute(`CREATE TRIGGER t_gone_upd BEFORE UPDATE OF role ON staff WHEN OLD.id = ${tmpId} BEGIN DELETE FROM staff WHERE id = OLD.id; SELECT RAISE(IGNORE); END`);
    const goneUpd = await api("PATCH", { id: tmpId, role: "admin" });
    await drop();
    tmpId = await mkTmp();
    await db.execute(`CREATE TRIGGER t_gone_del BEFORE DELETE ON staff WHEN OLD.id = ${tmpId} BEGIN DELETE FROM staff WHERE id = OLD.id; SELECT RAISE(IGNORE); END`);
    const goneDel = await api("DELETE", { id: tmpId });
    await drop();
    check("読んだあとで行が消えていたら 404（「管理者が 0 人になる」「最後の管理者は…」とは言わない）", goneUpd.status === 404 && goneUpd.j.error === "not found" && goneDel.status === 404 && goneDel.j.error === "not found", { goneUpd, goneDel });
    await db.execute({ sql: "DELETE FROM staff WHERE name LIKE ?", args: [TMP + "%"] });
    const after = await hashes();
    check("ここまでで、もとのスタッフの保存してある値（DB）は、1 つも書きかわっていない（パスワードなしのあいだは、パスワードを入れる口を開けていない）", after === before);
  } else {
    // ---- 「パスワードに戻した」状態（PASSWORD_REQUIRED = true）。scripts/test-staff-pwmode.cjs が、一時のコピーで作った版に向けて回す ----
    const sha = (pw) => crypto.createHash("sha256").update("sksl.staff.v1:" + pw).digest("hex"); // 前の保存の形（鍵なし）＝古いデプロイが書く値
    const send = (method, url, body, cookie) => fetch(`${BASE}${url}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
      .then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})), cookie: (r.headers.get("set-cookie") || "").split(";")[0] }));
    const tryLogin = (name, password) => send("POST", "/api/admin/login", { name, password });
    const ADMIN_PW = process.env.ADMIN_PW || ""; // サーバーに付けた ADMIN_PASSWORD と同じ値（このテストだけの値。8 文字以上）
    const passOf = async (name) => String((await db.execute({ sql: "SELECT pass_hash FROM staff WHERE name = ?", args: [name] })).rows[0]?.pass_hash ?? "");
    const idOf = async (name) => Number((await db.execute({ sql: "SELECT id FROM staff WHERE name = ?", args: [name] })).rows[0]?.id ?? 0);
    const roleOf = async (id) => String((await db.execute({ sql: "SELECT role FROM staff WHERE id = ?", args: [id] })).rows[0]?.role);
    const adminsNow = async () => Number((await db.execute("SELECT COUNT(*) AS n FROM staff WHERE role = 'admin'")).rows[0].n);
    if (ADMIN_PW.length < 8) {
      check("（準備）ADMIN_PW（サーバーの ADMIN_PASSWORD と同じ値・8 文字以上）を付けて回す", false, "node scripts/test-staff-pwmode.cjs から回してください");
    } else {
    // ---- 1. 前の形のパスワードは、どれも通らない。DB の値は、消さない ----
    //  無しのあいだの状態を作る: 管理者に「前の ADMIN_PASSWORD」・スタッフに「前に公開されていた仮パスワード」の、前の形（鍵なし）の値
    const OLD_ADMIN = "old-admin-value-1234", OLD_TEMP = "old-temp-value";
    await db.execute({ sql: "UPDATE staff SET pass_hash = ? WHERE role = 'admin'", args: [sha(OLD_ADMIN)] });
    await db.execute({ sql: "UPDATE staff SET pass_hash = ? WHERE name = '細田'", args: [sha(OLD_TEMP)] });
    await db.execute({ sql: "UPDATE staff SET pass_hash = '' WHERE name IN ('長山', '小倉')", args: [] });
    if (!(await idOf(NEW))) await db.execute({ sql: "INSERT INTO staff (name, pass_hash, role) VALUES (?, '', 'staff')", args: [NEW] });
    const oldAdmin = await tryLogin("杉本", OLD_ADMIN);
    const oldTemp = await tryLogin("細田", OLD_TEMP);
    check("戻したとき: 前の形（鍵なし）のパスワードは、どれも通らない。DB の値は、消さない（空にしない）",
      oldAdmin.status === 401 && oldTemp.status === 401 && !oldAdmin.cookie && (await passOf("杉本")) === sha(OLD_ADMIN) && (await passOf("細田")) === sha(OLD_TEMP), [oldAdmin.status, oldTemp.status]);
    check("いまの形のパスワードが無いスタッフには、「管理者に初期化してもらう」と出る。管理者には出ない（ADMIN_PASSWORD で入れる）",
      String(oldTemp.j.error).includes("まだパスワードが入っていません") && oldAdmin.j.error === "名前またはパスワードが違います", [oldTemp.j.error, oldAdmin.j.error]);
    // ---- 2. 管理者は、Vercel の ADMIN_PASSWORD の値で入る。その値が、いまの形で保存される ----
    const owner = await tryLogin("杉本", ADMIN_PW);
    const ownerHash = await passOf("杉本");
    check("管理者は、ADMIN_PASSWORD の値で入れる。その値が、いまの形（k2.）で保存される。印の種類は pw2", owner.status === 200 && owner.j.role === "admin" && ownerHash.startsWith("k2.") && /^sksl_staff=pw2\.\d+\.admin\./.test(owner.cookie), [owner.status, ownerHash.slice(0, 3), owner.cookie.slice(0, 20)]);
    const adminCk = owner.cookie;
    const again = await tryLogin("杉本", ADMIN_PW);
    check("もう一度、同じ値で入れる。保存した値は変わらない（毎回、書きかえない）", again.status === 200 && (await passOf("杉本")) === ownerHash);
    // ---- 3. 管理者の「パスワード初期化」で、スタッフが入れるようになる ----
    const nagayamaId = await idOf("長山"), hosodaId = await idOf("細田");
    const init1 = await send("PATCH", "/api/admin/staff", { id: nagayamaId, password: TEST_PW }, adminCk);
    const init2 = await send("PATCH", "/api/admin/staff", { id: hosodaId, password: TEST_PW }, adminCk);
    const h1 = await passOf("長山"), h2 = await passOf("細田");
    check("管理者が「パスワード初期化」をすると、いまの形で保存される。同じパスワードでも、人がちがえば値はちがう", init1.status === 200 && init2.status === 200 && h1.startsWith("k2.") && h2.startsWith("k2.") && h1 !== h2, [init1.status, init2.status, h1.slice(0, 3), h1 === h2]);
    check("スタッフの印では、「パスワード初期化」はできない（401）", (await send("PATCH", "/api/admin/staff", { id: hosodaId, password: "zzzz-9999" }, (await tryLogin("長山", TEST_PW)).cookie)).status === 401 && (await passOf("細田")) === h2);
    // ---- 3b. ADMIN_PASSWORD の値で入れるのは、管理者だけ ----
    const staffByEnv = await tryLogin("細田", ADMIN_PW);
    check("スタッフの名前＋ADMIN_PASSWORD の値では、入れない（その値で入れるのは、管理者だけ。スタッフの値も書きかわらない）", staffByEnv.status === 401 && !staffByEnv.cookie && (await passOf("細田")) === h2, [staffByEnv.status]);
    // ---- 3c. 「まだパスワードが入っていません」の案内は、失敗の数に入れない（戻した直後は、全員がこの状態）----
    await tryLogin("杉本", ADMIN_PW); // 失敗の数を 0 に戻す
    const hints = [];
    for (let i = 0; i < 10; i++) hints.push(await tryLogin(NEW, "x" + i)); // NEW は、パスワードが空のまま
    const afterHints = await tryLogin("長山", TEST_PW);
    check("案内が 10 回つづいても、ほかの人のログインは止まらない（失敗 8 回で 60 秒止める、の数に入れない）", hints.every((x) => x.status === 401 && String(x.j.error).includes("まだパスワードが入っていません")) && afterHints.status === 200, [hints.map((x) => x.status).join(), afterHints.status]);
    // ---- 3d. 短いパスワードは、入れない ----
    const short1 = await send("PATCH", "/api/admin/staff", { id: hosodaId, password: "abc" }, adminCk);
    const short2 = await send("POST", "/api/admin/staff", { name: NEW + "短", password: "abc" }, adminCk);
    const short3 = await send("POST", "/api/admin/change-password", { current: TEST_PW, newPassword: "abc" }, afterHints.cookie);
    check("3 文字のパスワードは、入れない（初期化・追加・自分の変更とも 400）。値は変わらない・行は増えない", short1.status === 400 && short2.status === 400 && short3.status === 400 && (await passOf("細田")) === h2 && (await passOf("長山")) === h1 && !(await idOf(NEW + "短")), [short1.status, short2.status, short3.status]);
    // ---- 4. 古いデプロイが、あとから前の形で入れ直しても、通らない（「1 回だけ空にする」では防げなかった穴）----
    await db.execute({ sql: "UPDATE staff SET pass_hash = ? WHERE name = '長山'", args: [sha(TEST_PW)] });
    const injected = await tryLogin("長山", TEST_PW);
    await db.execute({ sql: "INSERT INTO staff (name, pass_hash, role) VALUES (?, ?, 'admin') ON CONFLICT(name) DO UPDATE SET pass_hash = excluded.pass_hash, role = 'admin'", args: [NEW + "偽", sha("attacker-pass-1")] });
    const fakeAdmin = await tryLogin(NEW + "偽", "attacker-pass-1");
    await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [NEW + "偽"] });
    await db.execute({ sql: "UPDATE staff SET pass_hash = ? WHERE name = '長山'", args: [h1] });
    check("古いデプロイが、戻したあとで入れ直したパスワード・足した管理者（前の形）では、入れない", injected.status === 401 && fakeAdmin.status === 401 && !injected.cookie && !fakeAdmin.cookie, [injected.status, fakeAdmin.status]);
    // ---- 5. 画面 ----
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
    const ck2 = (await a.ctx.cookies()).find((c) => c.name === "sksl_staff");
    await a.ctx.close();
    check("戻したとき: ログインの印の種類は pw2", !!ck2 && /^pw2\.\d+\.staff\.[\w-]+$/.test(ck2.value), ck2 && ck2.value.split(".").slice(0, 3).join("."));
    check("戻したとき: パスワードなしのあいだに出した印（nopw）は、もう使えない（管理者の印でも 401）", (await tryCookie(nopwCookie(ownerId))) === 401);
    const legacy = legacyCookie(ownerId);
    check("戻したとき: 前の形（ID.権限.署名）の印も、使えない", !!legacy && (await tryCookie(legacy)) === 401);
    check("戻したとき: 種類が pw2 でも、公開の鍵で署名した印は使えない（パスワードありの鍵は、env から作る）", (await tryCookie(pw2ByOpenKey(ownerId))) === 401);
    const asStaff2 = ck2 ? await tryStaffCookie(ck2.value) : 0;
    const forged = ck2 ? await tryStaffCookie(ck2.value.replace(/\.staff\./, ".admin.")) : 0;
    check("戻したとき: パスワードで入った印（pw2）は、通る。権限を書きかえた印は、通らない", asStaff2 === 200 && forged === 401, [asStaff2, forged]);
    const noName = await send("POST", "/api/admin/login", { name: "長山" });
    check("戻したとき: 名前だけの送信では入れない", noName.status === 401, noName.status);
    const empty = await tryLogin(NEW, ""), empty2 = await tryLogin(NEW, TEST_PW);
    check("戻したとき: パスワードなしのあいだに追加したスタッフ（空のまま）は、入れない（管理者が入れ直すまで）。案内が出る", empty.status === 401 && empty2.status === 401 && String(empty2.j.error).includes("まだパスワードが入っていません"), [empty.status, empty2.status, empty2.j.error]);
    // ---- 6. 自分のパスワード変更 ----
    const staffCk = ck2 ? `sksl_staff=${ck2.value}` : "";
    const NEW_PW = "local-test-5678";
    const chBad = await send("POST", "/api/admin/change-password", { current: "wrong-value", newPassword: NEW_PW }, staffCk);
    const chOk = await send("POST", "/api/admin/change-password", { current: TEST_PW, newPassword: NEW_PW }, staffCk);
    const afterOld = await tryLogin("長山", TEST_PW), afterNew = await tryLogin("長山", NEW_PW);
    check("自分のパスワード変更: いまのパスワードが合わなければ 401。合えば変わる（前の値では入れない・新しい値で入れる・保存はいまの形）",
      chBad.status === 401 && chOk.status === 200 && afterOld.status === 401 && afterNew.status === 200 && (await passOf("長山")).startsWith("k2.") && (await passOf("長山")) !== h1, [chBad.status, chOk.status, afterOld.status, afterNew.status]);
    await send("POST", "/api/admin/change-password", { current: NEW_PW, newPassword: TEST_PW }, staffCk); // あとの確かめのために、戻しておく
    // ---- 7. 管理者がスタッフを足す（パスワードつき）----
    await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [NEW + "3"] });
    const add = await send("POST", "/api/admin/staff", { name: NEW + "3", password: TEST_PW }, adminCk);
    const addLogin = await tryLogin(NEW + "3", TEST_PW);
    check("管理者が足したスタッフは、そのパスワードで入れる（保存はいまの形）", add.status === 200 && addLogin.status === 200 && (await passOf(NEW + "3")).startsWith("k2."), [add.status, addLogin.status]);
    await db.execute({ sql: "DELETE FROM staff WHERE name = ?", args: [NEW + "3"] });
    // 名前の前後に空白を付けて足しても、保存する名前（空白なし）で、パスワードが合う（保存の値は、保存する名前で作る）
    const addSp = await send("POST", "/api/admin/staff", { name: "  " + NEW + "4  ", password: TEST_PW }, adminCk);
    const addSpLogin = await tryLogin(NEW + "4", TEST_PW);
    check("名前の前後に空白を付けて足しても、空白なしの名前で入れる", addSp.status === 200 && (await idOf(NEW + "4")) > 0 && addSpLogin.status === 200, [addSp.status, addSpLogin.status]);
    // 名前とパスワードの切れ目を、ずらせない（名前「A⏎X」＋「abcd-1234」と、名前「A」＋「X⏎abcd-1234」が、同じ保存の値にならない）
    await db.execute({ sql: "DELETE FROM staff WHERE name IN (?, ?)", args: [NEW + "5", NEW + "5\nX"] });
    const amb1 = await send("POST", "/api/admin/staff", { name: NEW + "5", password: "X\nabcd-1234" }, adminCk);
    const amb2 = await send("POST", "/api/admin/staff", { name: NEW + "5\nX", password: "abcd-1234" }, adminCk);
    const ambSame = amb1.status === 200 && amb2.status === 200 ? (await passOf(NEW + "5")) === (await passOf(NEW + "5\nX")) : null;
    check("名前とパスワードの切れ目をずらしても、保存の値は同じにならない", ambSame === false || amb2.status !== 200, [amb1.status, amb2.status, ambSame]);
    await db.execute({ sql: "DELETE FROM staff WHERE name IN (?, ?, ?)", args: [NEW + "4", NEW + "5", NEW + "5\nX"] });
    // ---- 8. 「最後の管理者を一般に下げない」: 口が、守りの SQL に、頼まれた権限をそのまま渡しているか ----
    //  割りこみを作る: 口が「下げる相手」を読んだあと（そのときは一般）で、相手がただ 1 人の管理者になる。
    //  パスワードの入れ直しと権限の変更を 1 つの依頼で送ると、口は パスワードを書く → 権限を書く の順に動く。
    //  パスワードを書いた瞬間に、DB の仕掛け（トリガー）で「相手を管理者に上げ、ほかの管理者を一般に下げる」を起こす。
    //  口は、最初に読んだ「一般」を信じて手前の数え方を飛ばす → 止められるのは、書きかえる SQL の中の守りだけ
    await db.execute("DROP TRIGGER IF EXISTS t_swap");
    await db.execute(`CREATE TRIGGER t_swap AFTER UPDATE OF pass_hash ON staff WHEN NEW.id = ${hosodaId} BEGIN UPDATE staff SET role = 'admin' WHERE id = ${hosodaId}; UPDATE staff SET role = 'staff' WHERE role = 'admin' AND id <> ${hosodaId}; END`);
    const swap = await send("PATCH", "/api/admin/staff", { id: hosodaId, password: TEST_PW, role: "staff" }, adminCk);
    await db.execute("DROP TRIGGER IF EXISTS t_swap");
    const swapRole = await roleOf(hosodaId), swapAdmins = await adminsNow();
    await db.execute({ sql: "UPDATE staff SET role = 'admin' WHERE id = ?", args: [ownerId] });
    await db.execute({ sql: "UPDATE staff SET role = 'staff' WHERE id = ?", args: [hosodaId] });
    check("読んだあとで、相手がただ 1 人の管理者になっていても、下げない（409。管理者は 0 人にならない）", swap.status === 409 && swapRole === "admin" && swapAdmins === 1, { status: swap.status, swapRole, swapAdmins });
    }
  }

  check("画面のエラーが無い", errors.length === 0, errors.slice(0, 3));
  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
