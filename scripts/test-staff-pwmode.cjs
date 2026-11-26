// 「パスワードに戻す」スイッチ（src/lib/staff-login.ts の PASSWORD_REQUIRED = true）が効くことを、**このフォルダを書きかえずに**確かめる。
// ⚠ ローカル専用。本番の DB につながる設定（TURSO_DATABASE_URL）があるときは、何もせずに止まる。
//
// やること:
//   1. このフォルダを、一時の場所へ写す（node_modules は元を指すだけ。.next・data・.git は写さない）
//   2. 写しのほうの PASSWORD_REQUIRED を true にして、ビルドする（1〜2 分）
//   3. 写しのサーバーを、env を替えながら立て直して、確かめる
//        A. ふつうの設定（ADMIN_PASSWORD と STAFF_COOKIE_SECRET あり）… scripts/test-staff-login.cjs を MODE=pw で回す（画面つき）
//        B. 立て直しても、入れたパスワード・出した印は、そのまま使える（立て直すたびに消えたりしない）
//        C. STAFF_COOKIE_SECRET を入れ替える … 印もパスワードも、まとめて無効になる。管理者は ADMIN_PASSWORD で入り直せる。DB は消えない
//        D. ADMIN_PASSWORD が短い（8 文字未満）… 管理者に「まだパスワードが入っていません。env を入れて…」と伝える。何も消さない
//        E. env が 1 つも無い … だれも入れない（503）。開発用の決まった値で作った印は、通らない。DB に何も書かない
//        F. もとの設定に戻す … B のパスワード・印が、また使える（何も壊していない）
//   4. 写しを消す（KEEP=1 を付けると残す）
//
// 使い方（このリポの直下で）:  node scripts/test-staff-pwmode.cjs [写しを置くフォルダ]
//   PORT=3889（既定）。Playwright は、このリポの依存には入れていない（クラウドのセッションには最初から入っている）。
//   ここで使う値（パスワード・鍵）は、どれもこのテストだけの作りもの。
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const root = process.cwd();
if (process.env.TURSO_DATABASE_URL) { console.error("本番の DB につながる設定（TURSO_DATABASE_URL）があるので、止めます"); process.exit(1); }
if (!fs.existsSync(path.join(root, "src/lib/staff-login.ts"))) { console.error("このリポの直下で回してください"); process.exit(1); }
const PORT = Number(process.env.PORT || 3889);
const BASE = `http://localhost:${PORT}`;
const WORK = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "sake-pwmode-")));
if (WORK === root || WORK.startsWith(root + path.sep)) { console.error("写しを置くフォルダは、このリポの外にしてください"); process.exit(1); }
const { createClient } = require(path.join(root, "node_modules/@libsql/client"));

const ADMIN_PW = "local-admin-1234";
const SECRET_A = "local-cookie-secret-A-0123456789";
const SECRET_B = "local-cookie-secret-B-9876543210";
const TEST_PW = "local-test-1234"; // scripts/test-staff-login.cjs が「長山」に入れる値と同じ

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}${detail !== "" ? ` … ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseEnv = () => { const e = { ...process.env }; for (const k of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "ADMIN_PASSWORD", "STAFF_COOKIE_SECRET", "NODE_ENV", "PORT"]) delete e[k]; return e; };
const nextBin = () => path.join(WORK, "node_modules/next/dist/bin/next");

let server = null;
async function start(extra) {
  await stop();
  const log = fs.openSync(path.join(WORK, "server.log"), "a");
  server = spawn(process.execPath, [nextBin(), "start", "-p", String(PORT)], { cwd: WORK, env: { ...baseEnv(), ...extra }, stdio: ["ignore", log, log] });
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    const r = await fetch(`${BASE}/api/admin/login`).catch(() => null);
    if (r && r.status === 200) return true;
    if (server.exitCode != null) break;
  }
  return false;
}
async function stop() {
  if (!server) return;
  const p = server; server = null;
  if (p.exitCode == null) { p.kill("SIGTERM"); for (let i = 0; i < 40 && p.exitCode == null; i++) await sleep(250); if (p.exitCode == null) p.kill("SIGKILL"); }
  await sleep(500);
}
const send = (method, url, body, cookie) => fetch(`${BASE}${url}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  .then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})), cookie: (r.headers.get("set-cookie") || "").split(";")[0] }));
const login = (name, password) => send("POST", "/api/admin/login", { name, password });
const asStaff = async (cookie) => (await send("GET", "/api/admin/settings", null, cookie)).status; // スタッフならだれでも読める口
const asAdmin = async (cookie) => (await send("GET", "/api/admin/staff", null, cookie)).status;    // 管理者だけの口
const hmac = (key, body) => crypto.createHmac("sha256", key).update(body).digest("base64url");

(async () => {
  // ---- 1. 写す ----
  console.log(`写し: ${WORK}`);
  const skip = new Set(["node_modules", ".next", "data", ".git"]);
  fs.mkdirSync(WORK, { recursive: true });
  for (const name of fs.readdirSync(root)) {
    if (skip.has(name)) continue;
    fs.cpSync(path.join(root, name), path.join(WORK, name), { recursive: true });
  }
  if (!fs.existsSync(path.join(WORK, "node_modules"))) fs.symlinkSync(path.join(root, "node_modules"), path.join(WORK, "node_modules"), "dir");
  // ---- 2. 写しのほうだけ true にして、ビルド ----
  const flagFile = path.join(WORK, "src/lib/staff-login.ts");
  const src = fs.readFileSync(flagFile, "utf8");
  const FROM = "export const PASSWORD_REQUIRED: boolean = false;";
  if (src.split(FROM).length !== 2) { console.error("PASSWORD_REQUIRED の行が、思っていた形とちがいます（すでに true になっていませんか）"); process.exit(1); }
  fs.writeFileSync(flagFile, src.replace(FROM, "export const PASSWORD_REQUIRED: boolean = true;"));
  check("このフォルダの PASSWORD_REQUIRED は false のまま（書きかえるのは、写しだけ）", fs.readFileSync(path.join(root, "src/lib/staff-login.ts"), "utf8").includes(FROM));
  console.log("ビルドしています（1〜2 分）…");
  const blog = fs.openSync(path.join(WORK, "build.log"), "w");
  const b = spawnSync(process.execPath, [nextBin(), "build"], { cwd: WORK, env: baseEnv(), stdio: ["ignore", blog, blog] });
  if (b.status !== 0) { console.error("ビルドに失敗しました。" + path.join(WORK, "build.log") + " を見てください"); console.error(fs.readFileSync(path.join(WORK, "build.log"), "utf8").slice(-1500)); process.exit(1); }
  fs.rmSync(path.join(WORK, "data"), { recursive: true, force: true }); // ビルドのあいだに出来た DB は使わない（まっさらから始める）

  // 印を作る材料（開発用の決まった値は、ソースから読む。ここに書き写さない）
  const authSrc = fs.readFileSync(path.join(WORK, "src/lib/auth.ts"), "utf8");
  const dev = (/\$\{admin \|\| "([^"]+)"\}/.exec(authSrc) || [])[1] || "";
  const keyFrom = (from) => crypto.scryptSync(from, "sksl.staff.cookie.v2", 32);
  const pw2 = (key, id, role) => `sksl_staff=pw2.${id}.${role}.${hmac(key, `pw2.${id}.${role}`)}`;
  const dbFile = path.join(WORK, "data/sake-library.db");
  let db = null;
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
  const hashes = async () => (await q("SELECT name, pass_hash FROM staff ORDER BY id")).map((r) => `${r.name}:${r.pass_hash}`).join("|");
  const others = async () => (await q("SELECT name, pass_hash FROM staff WHERE role <> 'admin' ORDER BY id")).map((r) => `${r.name}:${r.pass_hash}`).join("|");

  try {
    // ---- A. ふつうの設定: 画面つきの確かめを回す ----
    check("A: サーバーが立つ（ADMIN_PASSWORD と STAFF_COOKIE_SECRET あり）", await start({ ADMIN_PASSWORD: ADMIN_PW, STAFF_COOKIE_SECRET: SECRET_A }));
    const sub = spawnSync(process.execPath, [path.join(WORK, "scripts/test-staff-login.cjs")], { cwd: WORK, env: { ...baseEnv(), MODE: "pw", ADMIN_PW, BASE }, encoding: "utf8" });
    const out = `${sub.stdout || ""}${sub.stderr || ""}`;
    for (const line of out.split("\n")) if (line.trim()) console.log("   | " + line);
    const m = /(\d+) passed, (\d+) failed/.exec(out);
    check(`A: scripts/test-staff-login.cjs（MODE=pw）が全部通る（${m ? m[0] : "結果が読めない"}）`, sub.status === 0 && !!m && Number(m[2]) === 0 && Number(m[1]) >= 20, out.slice(-300));
    db = createClient({ url: "file:" + dbFile });
    const ownerId = Number((await q("SELECT id FROM staff WHERE role = 'admin' ORDER BY id LIMIT 1"))[0].id);
    const made = pw2(keyFrom(`s:${SECRET_A}`), ownerId, "admin");
    check("A: このテストが作った印（STAFF_COOKIE_SECRET から、サーバーと同じ手順で作る）が通る＝作り方が合っている", (await asAdmin(made)) === 200, await asAdmin(made));
    const l1 = await login("長山", TEST_PW);
    const C1 = l1.cookie;
    check("A: 長山が、入れてもらったパスワードで入れる。印が出る", l1.status === 200 && /^sksl_staff=pw2\./.test(C1) && (await asStaff(C1)) === 200, [l1.status, C1.slice(0, 16)]);
    const H1 = await hashes();

    // ---- B. 立て直しても、そのまま ----
    check("B: サーバーを立て直す（同じ設定）", await start({ ADMIN_PASSWORD: ADMIN_PW, STAFF_COOKIE_SECRET: SECRET_A }));
    const b1 = await login("長山", "wrong-value"), b2 = await login("長山", TEST_PW);
    check("B: 立て直しても、出してあった印・入れてあったパスワードは、そのまま使える。DB の値は 1 つも変わらない（立て直すたびに消えない）",
      (await asStaff(C1)) === 200 && b1.status === 401 && b2.status === 200 && (await hashes()) === H1, [await asStaff(C1), b1.status, b2.status, (await hashes()) === H1]);

    // ---- C. 鍵のもとを入れ替える ----
    check("C: サーバーを立て直す（STAFF_COOKIE_SECRET を入れ替え）", await start({ ADMIN_PASSWORD: ADMIN_PW, STAFF_COOKIE_SECRET: SECRET_B }));
    const o1 = await others();
    const c1 = await login("長山", TEST_PW);
    check("C: 鍵のもとを入れ替えると、前の印も、前のパスワードも、通らない（まとめて無効）", (await asStaff(C1)) === 401 && (await asAdmin(made)) === 401 && c1.status === 401 && !c1.cookie && c1.j.error === "名前またはパスワードが違います", [await asStaff(C1), c1.status, c1.j.error]);
    const c2 = await login("杉本", ADMIN_PW);
    check("C: 管理者は、ADMIN_PASSWORD の値で入り直せる。ほかの人の保存してある値は、消えていない（通らないだけ）", c2.status === 200 && c2.j.role === "admin" && (await others()) === o1 && o1.includes("k2."), [c2.status, (await others()) === o1]);

    // ---- D. ADMIN_PASSWORD が短い ----
    await db.execute("UPDATE staff SET pass_hash = '' WHERE role = 'admin'"); // 戻した直後の管理者（いまの形のパスワードが、まだ無い）
    const o2 = await others();
    check("D: サーバーを立て直す（ADMIN_PASSWORD が 5 文字・STAFF_COOKIE_SECRET なし）", await start({ ADMIN_PASSWORD: "short" }));
    const d1 = await login("杉本", "short"), d2 = await login("杉本", ADMIN_PW);
    check("D: ADMIN_PASSWORD が 8 文字未満なら、管理者に「env を入れてデプロイし直す」と伝える（503）。入れない・何も消さない",
      d1.status === 503 && d2.status === 503 && String(d1.j.error).includes("管理者のパスワードが、まだ入っていません") && !d1.cookie && (await others()) === o2 && (await q("SELECT pass_hash FROM staff WHERE role = 'admin'"))[0].pass_hash === "", [d1.status, d2.status, d1.j.error]);

    // ---- E. env が 1 つも無い ----
    check("E: サーバーを立て直す（env なし）。名前の一覧は出る", await start({}));
    const before = { logins: Number((await q("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'staff.login'"))[0].n), last: String((await q("SELECT last_login FROM staff WHERE name = '長山'"))[0].last_login) };
    const e1 = await login("長山", TEST_PW), e2 = await login("杉本", ADMIN_PW), e3 = await login("いない人", "x");
    const after = { logins: Number((await q("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'staff.login'"))[0].n), last: String((await q("SELECT last_login FROM staff WHERE name = '長山'"))[0].last_login) };
    check("E: env が無ければ、だれも入れない（503・「準備がまだ終わっていません」）。印を出さない・「入った」の記録も付けない",
      [e1, e2, e3].every((x) => x.status === 503 && !x.cookie && String(x.j.error).includes("ログインの準備が、まだ終わっていません")) && after.logins === before.logins && after.last === before.last, [e1.status, e2.status, e3.status, before, after]);
    const forged = [
      await asAdmin(pw2(keyFrom(`p:${dev}`), ownerId, "admin")),                 // 開発用の決まった値から、サーバーと同じ手順で作った鍵
      await asAdmin(pw2(dev, ownerId, "admin")),                                  // 開発用の決まった値そのものを鍵に
      await asAdmin(pw2("sksl.staff.nopw.v1", ownerId, "admin")),                 // 公開の鍵（パスワードなしの印の鍵）
      await asAdmin(`sksl_staff=nopw.${ownerId}.admin.${hmac("sksl.staff.nopw.v1", `nopw.${ownerId}.admin`)}`),
      await asAdmin(`sksl_staff=${ownerId}.admin.${hmac(dev, `${ownerId}.admin`)}`), // 前の形
      await asAdmin(made), await asStaff(C1),
    ];
    check("E: 開発用の決まった値（このリポは公開＝だれでも読める）で作った印は、通らない。ほかの印も通らない", !!dev && forged.every((x) => x === 401), forged);

    // ---- F. もとの設定に戻す ----
    check("F: サーバーを立て直す（A と同じ設定）", await start({ ADMIN_PASSWORD: ADMIN_PW, STAFF_COOKIE_SECRET: SECRET_A }));
    const f1 = await login("長山", TEST_PW), f2 = await login("杉本", ADMIN_PW);
    check("F: もとの鍵に戻すと、A のパスワード・印が、また使える（途中で、何も壊していない）。管理者も ADMIN_PASSWORD で入れる", (await asStaff(C1)) === 200 && f1.status === 200 && f2.status === 200, [await asStaff(C1), f1.status, f2.status]);
  } finally {
    await stop();
    if (!process.env.KEEP) fs.rmSync(WORK, { recursive: true, force: true });
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error(e); await stop(); process.exit(1); });
