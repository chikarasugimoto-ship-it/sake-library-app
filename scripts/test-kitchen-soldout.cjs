// 厨房モニター（KM）からの「写真で売り切れ」（/api/kitchen/soldout）を、ローカルで通して確かめる。本番には向けないこと。
//   node scripts/test-kitchen-soldout.cjs
//
// 自分で立てて、終わったら止めて消すもの:
//   ・使い捨ての DB（OS の一時フォルダ）。本物の DB には、ぜったいに触らない（TURSO_DATABASE_URL を、ここで上書きする）
//   ・AI（Anthropic の API）の代わりをする、にせもののサーバー（127.0.0.1:MOCK_PORT）。本物の AI には、1 回も聞かない
//   ・この酒コレの dev サーバー（127.0.0.1:PORT）
// 鍵の値（local-test-…）は、どれもローカルのテスト用。本番の鍵ではない。
//
// 時間のかかる確かめ（AI が 20 秒返事をしないとき）は、SLOW=1 を付けたときだけ。
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const net = require("net");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3466);
const MOCK_PORT = Number(process.env.MOCK_PORT || 3467);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = "local-test-kitchen-0001";
const AI_KEY = "local-test-ai-key-0001";
const CRON = "local-test-cron-0001";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}${detail !== "" ? ` … ${(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 700)}` : ""}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sake-kitchen-soldout-"));
const dbFile = path.join(dir, "sake.db").replace(/\\/g, "/");
let child = null;
let mock = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { if (child && child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* もう止まっている */ }
  try { if (mock) mock.close(); } catch { /* */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 残っても一時フォルダ */ }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { cleanup(); process.exit(130); });
process.on("exit", cleanup);

const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.once("listening", () => s.close(() => resolve(true)));
  s.listen(port, "127.0.0.1");
});

// ---- にせものの AI ----
// queue に入れた答えを、呼ばれた順に返す。空のときは 500（＝テストの書きまちがいに気づける）
const aiCalls = [];
const queue = [];
const answer = (obj) => ({ kind: "answer", obj });
function startMock() {
  mock = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      if (req.method === "GET" && req.url.startsWith("/food")) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, items: [] })); return; }
      if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) { res.writeHead(404); res.end("{}"); return; }
      let j = {};
      try { j = JSON.parse(body); } catch { /* */ }
      aiCalls.push({ url: req.url, key: req.headers["x-api-key"] || "", beta: String(req.headers["anthropic-beta"] || ""), body: j });
      const next = queue.shift() || { kind: "status", status: 500 };
      if (next.kind === "slow") await sleep(next.ms);
      if (next.kind === "status") {
        res.writeHead(next.status, { "Content-Type": "application/json", ...(next.headers || {}) });
        res.end(JSON.stringify({ type: "error", error: { type: next.status === 400 ? "invalid_request_error" : next.status === 401 ? "authentication_error" : "api_error", message: "にせものの AI の、わざとの失敗" } }));
        return;
      }
      const msg = {
        id: "msg_local_test", type: "message", role: "assistant", model: next.model || j.model || "local-test-model",
        content: next.kind === "refusal" ? [] : [{ type: "text", text: next.kind === "text" ? next.text : JSON.stringify(next.obj) }],
        stop_reason: next.kind === "refusal" ? "refusal" : "end_turn", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(msg));
    });
  });
  return new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));
}

async function call(pathname, opt = {}) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(BASE + pathname, opt).catch(() => null);
    if (r) {
      const text = await r.text();
      // dev サーバーが作り直している最中は、中身の無い 500 を返すことがある → やり直す
      if (!(r.status === 500 && !text.trim().startsWith("{"))) { let j = {}; try { j = JSON.parse(text); } catch { /* */ } return { status: r.status, j, headers: r.headers }; }
    }
    await sleep(1500);
  }
  return { status: 0, j: {}, headers: new Headers() };
}
const URLK = `/api/kitchen/soldout?token=${TOKEN}`;
const post = (body, url = URLK) => call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
// 1×1 の JPEG（にせものの AI は、中身を見ない）
const IMG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
const photo = (extra = {}) => post({ op: "photo", image: IMG, media_type: "image/jpeg", ...extra });

(async () => {
  if (!(await portFree(PORT)) || !(await portFree(MOCK_PORT))) { console.error(`✗ ポート ${PORT} か ${MOCK_PORT} が、使われています（PORT= / MOCK_PORT= で変えられます）`); process.exit(2); }
  await startMock();

  // ---- dev サーバー。環境変数は、ここで決めたものだけ（.env* に本物の値があっても、ここの値が勝つ）----
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME || os.homedir(), NEXT_TELEMETRY_DISABLED: "1",
    TURSO_DATABASE_URL: "file:" + dbFile, TURSO_AUTH_TOKEN: "local-test-unused",
    MO_KITCHEN_TOKEN: TOKEN, SAKE_BRIDGE_SECRET: "local-test-bridge-0001",
    ANTHROPIC_API_KEY: AI_KEY, ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`, ANTHROPIC_AUTH_TOKEN: "",
    CRON_SECRET: CRON, MO_FOOD_SOLDOUT_URL: `http://127.0.0.1:${MOCK_PORT}/food`,
    OFFICE_NOTIFY_TOKEN: "", OFFICE_NOTIFY_URL: `http://127.0.0.1:${MOCK_PORT}/notify`, BLOB_READ_WRITE_TOKEN: "",
  };
  const log = fs.createWriteStream(path.join(dir, "dev.log"));
  child = spawn("npx", ["next", "dev", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { await sleep(2000); const r = await fetch(`${BASE}/api/kitchen/soldout`).catch(() => null); up = !!r && (r.status === 401 || r.status === 200); }
  if (!up) { console.error("✗ dev サーバーが立ち上がらない"); console.error(fs.readFileSync(path.join(dir, "dev.log"), "utf8").slice(-1500)); process.exit(1); }

  // ---- 使い捨ての DB に、見本を入れる（表は、上の最初の呼び出しで、アプリが作っている）----
  const first = await call(URLK);
  if (!fs.existsSync(dbFile)) { console.error("✗ 使い捨ての DB が、決めた場所に出来ていない（本物の DB につないでいるおそれ）。止める"); process.exit(1); }
  const { createClient } = require(path.join(ROOT, "node_modules", "@libsql", "client"));
  const db = createClient({ url: "file:" + dbFile });
  const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
  if (Number((await q("SELECT COUNT(*) AS n FROM sakes"))[0].n) !== 0 || first.status !== 200 || (first.j.sakes || []).length !== 0) { console.error("✗ 空のはずの DB に、日本酒がある。使い捨ての DB ではない。止める"); process.exit(1); }
  const ins = (id, brand, sub, o = {}) => db.execute({
    sql: `INSERT INTO sakes (id, brand, sub_name, brewery, prefecture, grade, price, status, archived, is_hidden, opened_at, soldout_at, stock_count, sort_order, bottle_size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${o.soldDaysAgo != null ? `datetime('now','localtime','-${o.soldDaysAgo} days')` : "''"}, ?, ?, '1.8L')`,
    args: [id, brand, sub, o.brewery || "", o.pref || "", o.grade || "", o.price ?? 900, o.status || "available", o.archived ? 1 : 0, o.hidden ? 1 : 0, o.opened || "", o.stock ?? null, o.sort ?? id],
  });
  await ins(101, "而今", "純米吟醸 山田錦", { brewery: "木屋正酒造", pref: "三重県", grade: "純米吟醸", opened: "2026-11-20 18:00:00" });
  await ins(102, "田酒", "特別純米", { brewery: "西田酒造店", pref: "青森県", grade: "特別純米" });
  await ins(103, "田酒", "純米吟醸 山廃", { brewery: "西田酒造店", pref: "青森県", grade: "純米吟醸", status: "low" });
  await ins(104, "新政", "No.6 S-type", { brewery: "新政酒造", pref: "秋田県", status: "low", opened: "2026-11-25 19:30:00", stock: 3 });
  await ins(105, "十四代", "本丸", { status: "soldout", soldDaysAgo: 1 });
  await ins(106, "獺祭", "純米大吟醸45", { status: "soldout", soldDaysAgo: 10 });
  await ins(107, "黒龍", "いっちょらい", { archived: true });
  await ins(108, "鍋島", "特別純米", { hidden: true });
  await ins(109, "飛露喜", "特別純米");
  await ins(110, "作", "穂乃智");
  await ins(111, "くどき上手", "純米吟醸");
  await ins(112, "風の森 ALPHA|1", "秋津穂\n657");
  const sake = async (id) => (await q("SELECT id, status, COALESCE(opened_at,'') AS opened_at, COALESCE(soldout_at,'') AS soldout_at, stock_count, archived FROM sakes WHERE id = ?", [id]))[0];
  const logs = (id) => q("SELECT * FROM kitchen_soldout WHERE sake_id = ? ORDER BY id", [id]);
  const audits = (action) => q("SELECT payload FROM audit_logs WHERE action = ? ORDER BY id", [action]);

  // ============================================================================
  // 1. 鍵・CORS・一覧
  // ============================================================================
  {
    const none = await call("/api/kitchen/soldout");
    const wrong = await call("/api/kitchen/soldout?token=wrong-token-000000000");
    const wrongPost = await post({ op: "soldout", sakeId: 101 }, "/api/kitchen/soldout?token=nope");
    const bearer = await call("/api/kitchen/soldout", { headers: { Authorization: `Bearer ${TOKEN}` } });
    check("鍵が無い・ちがうと 401（読むのも・売り切れにするのも）。Authorization の形でも通る", none.status === 401 && wrong.status === 401 && wrongPost.status === 401 && bearer.status === 200 && (await sake(101)).status === "available", [none.status, wrong.status, wrongPost.status, bearer.status]);
    const opt = await fetch(`${BASE}/api/kitchen/soldout`, { method: "OPTIONS" });
    check("ほかのドメインのページ（KM）から呼べる（CORS）", opt.status === 204 && opt.headers.get("access-control-allow-origin") === "*" && /POST/.test(opt.headers.get("access-control-allow-methods") || "") && bearer.headers.get("access-control-allow-origin") === "*");
    const l = await call(URLK);
    const ids = (l.j.sakes || []).map((s) => s.id);
    check("一覧: いま売り切れでないお酒だけ（売り切れ・削除ずみは出ない。非表示のお酒は出る）。AI が使えるかも返す", l.status === 200 && l.j.ok === true && l.j.ai === true && ids.join() === "101,102,103,104,108,109,110,111,112" && Array.isArray(l.j.recent) && l.j.recent.length === 0, ids);
    const s101 = l.j.sakes.find((s) => s.id === 101);
    check("一覧の 1 件: 銘柄・補足・蔵元・状態・残数。写真が無ければ、写真の道は空", s101.brand === "而今" && s101.subName === "純米吟醸 山田錦" && s101.brewery === "木屋正酒造" && s101.status === "available" && s101.stockCount === null && s101.photo === "" && l.j.sakes.find((s) => s.id === 104).stockCount === 3, s101);
  }

  // ============================================================================
  // 2. 写真 → はっきり 1 本に決まる → 売り切れにする
  // ============================================================================
  let logA = 0;
  {
    queue.push(answer({ bottle: true, read: { brand: "而今", sub_name: "純米吟醸 山田錦", brewery: "木屋正酒造" }, matches: [{ id: 101, confidence: 0.97 }] }));
    const r = await photo();
    const s = await sake(101);
    const lg = await logs(101);
    logA = Number(r.j.logId) || 0;
    check("写真 → はっきり 1 本に決まれば、売り切れにする（applied。お酒の中身と、元に戻すための番号が返る）", r.status === 200 && r.j.ok === true && r.j.result === "applied" && r.j.sake.id === 101 && r.j.sake.brand === "而今" && r.j.sake.status === "soldout" && logA > 0 && r.j.read.brand === "而今", r.j);
    check("DB: 売り切れ・売切日が入る・開栓日は消える（在庫ボードの「売切」と同じ）。残数には、さわらない", s.status === "soldout" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(s.soldout_at) && s.opened_at === "" && s.stock_count === null, s);
    check("控え: 前の状態（提供中）・前の開栓日・売切日が、1 行残る", lg.length === 1 && lg[0].how === "photo" && lg[0].prev_status === "available" && lg[0].prev_opened_at === "2026-11-20 18:00:00" && lg[0].sold_at === s.soldout_at && lg[0].undone_at === "" && Number(lg[0].id) === logA, lg);
    const ev = (await audits("sake.soldout_event")).map((x) => JSON.parse(x.payload));
    const st = (await audits("sake.status")).map((x) => JSON.parse(x.payload));
    const ph = (await audits("kitchen.photo")).map((x) => x.payload);
    check("記録: 売切イベント（夜の日報が拾う）・状態の変更（KM から）・読み取りの結果。写真そのものは、どこにも残さない",
      ev.length === 1 && ev[0].id === 101 && st.some((x) => x.id === 101 && x.status === "soldout" && x.by === "km" && x.how === "photo") && ph.length === 1 && /"result":"applied"/.test(ph[0]) && !ph[0].includes(IMG.slice(0, 40))
      && !JSON.stringify(await q("SELECT detail FROM kitchen_soldout")).includes(IMG.slice(0, 40)), [ev, st, ph]);

    // AI への聞き方
    const c = aiCalls[aiCalls.length - 1];
    const sys = c.body.system || [];
    const list = (sys[1] && sys[1].text) || "";
    const content = (c.body.messages && c.body.messages[0] && c.body.messages[0].content) || [];
    check("AI への聞き方: 決めたモデル・断られたときの回し先・考える深さは「低」・答えは決まった形の JSON。鍵は、テスト用のものだけが届く",
      c.url.startsWith("/v1/messages") && c.key === AI_KEY && c.body.model === "claude-opus-5-5" && JSON.stringify(c.body.fallbacks) === JSON.stringify([{ model: "claude-opus-4-8" }]) && c.beta.includes("server-side-fallback-2026-07-01")
      && c.body.output_config.effort === "low" && c.body.output_config.format.type === "json_schema" && c.body.output_config.format.schema.additionalProperties === false && c.body.max_tokens >= 4000 && c.body.thinking === undefined && c.body.temperature === undefined,
      { url: c.url, model: c.body.model, fallbacks: c.body.fallbacks, beta: c.beta, oc: c.body.output_config });
    check("AI に渡すのは、写真と、在庫リストだけ（リストは system の 2 つめ。続けて撮るあいだ変わらないよう、覚えさせる印つき）",
      sys.length === 2 && sys[1].cache_control && sys[1].cache_control.type === "ephemeral" && content.length === 2 && content[0].type === "image" && content[0].source.type === "base64" && content[0].source.media_type === "image/jpeg" && content[0].source.data === IMG && content[1].type === "text",
      { sysLen: sys.length, types: content.map((x) => x.type) });
    const lines = list.split("\n");
    check("在庫リスト: 削除していないお酒のうち、売り切れでないもの＋ここ 3 日で売り切れたもの（10 日前に売り切れたもの・削除ずみは入れない）。id の順",
      /在庫リスト（10 件）/.test(lines[0]) && lines.slice(2).map((x) => x.split(" | ")[0]).join() === "101,102,103,104,105,108,109,110,111,112" && lines[2].startsWith("101 | 而今 | 純米吟醸 山田錦 | 純米吟醸 | 木屋正酒造 | 三重県"), lines.slice(0, 4));
    check("在庫リストに、状態（売り切れかどうか）・時刻を入れない（1 本売り切れにしても、文が変わらない）。区切りの字・改行は、空白にする",
      !/soldout|available|low|\d\d:\d\d/.test(list) && lines.some((x) => x.startsWith("112 | 風の森 ALPHA 1 | 秋津穂 657 |")), list.slice(-200));
    // 続けてもう 1 枚（101 は、もう売り切れ）→ リストの文は、1 文字も変わらない
    queue.push(answer({ bottle: true, read: { brand: "而今", sub_name: "", brewery: "" }, matches: [{ id: 101, confidence: 0.95 }] }));
    const again = await photo();
    const list2 = aiCalls[aiCalls.length - 1].body.system[1].text;
    check("同じお酒を、もう一度撮る → 「もう売り切れです」（already）。控えは増えない。在庫リストの文は、前と 1 文字も変わらない", again.j.result === "already" && again.j.sake.id === 101 && (await logs(101)).length === 1 && list2 === list, again.j);
  }

  // ============================================================================
  // 3. 元に戻す
  // ============================================================================
  {
    const before = await call(URLK);
    check("一覧: KM から売り切れにしたお酒が「元に戻す」の所に出る。売り切れでないお酒の一覧からは消える", before.j.recent.length === 1 && before.j.recent[0].logId === logA && before.j.recent[0].sake.id === 101 && before.j.recent[0].how === "photo" && !before.j.sakes.some((s) => s.id === 101), before.j.recent);
    const cronBefore = await call(`/api/cron/daily-brief?dry=1&token=${CRON}`);
    const r = await post({ op: "restore", logId: logA });
    const s = await sake(101);
    check("元に戻す: 前の状態・前の開栓日に戻る。売切日は消える", r.status === 200 && r.j.ok === true && r.j.result === "restored" && r.j.sake.status === "available" && s.status === "available" && s.opened_at === "2026-11-20 18:00:00" && s.soldout_at === "", [r.j, s]);
    const again = await post({ op: "restore", logId: logA });
    check("もう一度押しても、何も起きない（409 already_restored）", again.status === 409 && again.j.error === "already_restored" && (await sake(101)).status === "available", again.j);
    const after = await call(URLK);
    const cronAfter = await call(`/api/cron/daily-brief?dry=1&token=${CRON}`);
    check("戻したあと: 「元に戻す」の所から消え、一覧に戻る", after.j.recent.length === 0 && after.j.sakes.some((s) => s.id === 101));
    check("夜の日報: 元に戻した売り切れは、「本日の完売」に数えない（戻す前は、数えていた）", cronBefore.status === 200 && cronBefore.j.sections.soldout === 1 && /而今/.test(cronBefore.j.text) && cronAfter.j.sections.soldout === 0 && !/而今/.test(cronAfter.j.text || ""), [cronBefore.j.sections, cronAfter.j.sections]);
    check("無い番号・おかしい番号", (await post({ op: "restore", logId: 99999 })).status === 404 && (await post({ op: "restore", logId: "x" })).status === 400);
  }

  // ============================================================================
  // 4. まちがった銘柄を、だまって売り切れにしない
  // ============================================================================
  {
    const n0 = Number((await q("SELECT COUNT(*) AS n FROM kitchen_soldout"))[0].n);
    // 同じ銘柄の種類ちがいが、メニューにある
    queue.push(answer({ bottle: true, read: { brand: "田酒", sub_name: "特別純米", brewery: "西田酒造店" }, matches: [{ id: 102, confidence: 0.98 }] }));
    const sib = await photo();
    check("同じ銘柄の種類ちがいがメニューにあるときは、確信度が高くても、自動では売り切れにしない（choose・sibling）。読み取った 1 本を先頭に、種類ちがいも候補に出す",
      sib.j.result === "choose" && sib.j.why === "sibling" && sib.j.candidates.map((c) => c.id).join() === "102,103" && (await sake(102)).status === "available" && (await sake(103)).status === "low", sib.j);
    // 確信度が足りない
    queue.push(answer({ bottle: true, read: { brand: "新政", sub_name: "", brewery: "" }, matches: [{ id: 104, confidence: 0.89 }] }));
    const low = await photo();
    check("確信度が 0.9 に届かないときは、自動では売り切れにしない（choose・unsure）", low.j.result === "choose" && low.j.why === "unsure" && low.j.candidates.map((c) => c.id).join() === "104" && (await sake(104)).status === "low", low.j);
    // 次点がいる
    queue.push(answer({ bottle: true, read: { brand: "飛露喜", sub_name: "", brewery: "" }, matches: [{ id: 109, confidence: 0.93 }, { id: 110, confidence: 0.6 }] }));
    const two = await photo();
    check("次点（0.5 より上）がいるときも、自動では売り切れにしない。候補は、確信度の高い順", two.j.result === "choose" && two.j.why === "unsure" && two.j.candidates.map((c) => c.id).join() === "109,110" && (await sake(109)).status === "available", two.j);
    // リストに無い番号
    queue.push(answer({ bottle: true, read: { brand: "獺祭", sub_name: "", brewery: "" }, matches: [{ id: 106, confidence: 0.99 }, { id: 107, confidence: 0.99 }, { id: 424242, confidence: 0.99 }] }));
    const ghost = await photo();
    check("AI が、リストに無い番号（古い売り切れ・削除ずみ・でたらめ）を返しても、そのお酒には触れない（none）", ghost.j.result === "none" && (await sake(106)).status === "soldout" && Number((await sake(107)).archived) === 1, ghost.j);
    // 合うものが無い
    queue.push(answer({ bottle: true, read: { brand: "久保田", sub_name: "千寿", brewery: "朝日酒造" }, matches: [] }));
    const none = await photo();
    check("リストに合うお酒が無い → none。読み取った文字を返す（スタッフが、一覧から選べるように）", none.j.result === "none" && none.j.read.brand === "久保田" && none.j.read.subName === "千寿" && none.j.candidates.length === 0, none.j);
    queue.push(answer({ bottle: false, read: { brand: "", sub_name: "", brewery: "" }, matches: [] }));
    const nob = await photo();
    check("瓶が写っていない → none（bottle: false）", nob.j.result === "none" && nob.j.bottle === false, nob.j);
    // ここ 3 日で売り切れたお酒
    queue.push(answer({ bottle: true, read: { brand: "十四代", sub_name: "本丸", brewery: "" }, matches: [{ id: 105, confidence: 0.96 }] }));
    const alr = await photo();
    check("もう売り切れのお酒 → already（何も変えない）", alr.j.result === "already" && alr.j.sake.id === 105 && (await logs(105)).length === 0, alr.j);
    // 確かめるだけ
    queue.push(answer({ bottle: true, read: { brand: "鍋島", sub_name: "", brewery: "" }, matches: [{ id: 108, confidence: 0.99 }] }));
    const dry = await photo({ apply: false });
    check("apply: false なら、はっきり決まっても売り切れにしない（候補として返す）", dry.j.result === "choose" && dry.j.why === "confirm" && dry.j.candidates.map((c) => c.id).join() === "108" && (await sake(108)).status === "available", dry.j);
    // 答えが、JSON でない
    queue.push({ kind: "text", text: "すみません、読めませんでした。" });
    const junk = await photo();
    check("AI の答えが読めないときは、何もしない（502 ai_error）", junk.status === 502 && junk.j.ok === false && junk.j.error === "ai_error", junk.j);
    // 前置きつきの JSON（前からの形で聞いたときに、ありうる）
    queue.push({ kind: "text", text: '結果です:\n{"bottle": true, "read": {"brand": "鍋島", "sub_name": "", "brewery": ""}, "matches": [{"id": "108", "confidence": 1.7}, {"id": 108, "confidence": 0.2}, {"id": -1, "confidence": 0.9}]}' });
    const pre = await photo({ apply: false });
    check("前置きつきの JSON・文字の番号・1 を超える確信度・同じ番号の重なり・負の番号も、落ちずに読む（番号は 1 つに・確信度は 1 まで）", pre.j.result === "choose" && pre.j.candidates.map((c) => c.id).join() === "108", pre.j);
    // 銘柄の欄に、種類まで書いてある登録
    await ins(113, "風の森", "露葉風 807");
    queue.push(answer({ bottle: true, read: { brand: "風の森", sub_name: "露葉風 807", brewery: "" }, matches: [{ id: 113, confidence: 0.99 }] }));
    const pfx = await photo();
    check("銘柄の名前が、別のお酒の銘柄の頭と同じとき（「風の森」と「風の森 ALPHA 1」）も、種類ちがいとして扱う（自動では売り切れにしない）", pfx.j.result === "choose" && pfx.j.why === "sibling" && pfx.j.candidates.map((c) => c.id).join() === "113,112" && (await sake(113)).status === "available", pfx.j);
    check("ここまで、控えは 1 行も増えていない（どれも、売り切れにしていない）", Number((await q("SELECT COUNT(*) AS n FROM kitchen_soldout"))[0].n) === n0);

    // 候補から選ぶ
    const pick = await post({ op: "soldout", sakeId: 103, how: "candidate" });
    const s103 = await sake(103);
    const l103 = await logs(103);
    check("候補から選ぶ: 売り切れになる。前の状態（残りわずか）を控える", pick.j.result === "applied" && pick.j.logId > 0 && s103.status === "soldout" && l103.length === 1 && l103[0].how === "candidate" && l103[0].prev_status === "low", [pick.j, l103]);
    const back = await post({ op: "restore", logId: pick.j.logId });
    check("…元に戻すと、「残りわずか」に戻る", back.j.result === "restored" && (await sake(103)).status === "low", back.j);
  }

  // ============================================================================
  // 4b. 自動で売り切れにしないとき（2026-11-27 レビューの指摘）
  // ============================================================================
  {
    const n0 = Number((await q("SELECT COUNT(*) AS n FROM kitchen_soldout"))[0].n);
    // 同じ銘柄の種類ちがいが、きのう売り切れている（空いた瓶が撮られるのは、このころ）
    await db.execute({ sql: "UPDATE sakes SET status = 'soldout', soldout_at = datetime('now','localtime','-1 days') WHERE id = 103", args: [] });
    queue.push(answer({ bottle: true, read: { brand: "田酒", sub_name: "", brewery: "" }, matches: [{ id: 102, confidence: 0.93 }, { id: 103, confidence: 0.45 }] }));
    const s1 = await photo();
    check("同じ銘柄の種類ちがいが、売り切れずみでも、自動では売り切れにしない（choose。売り切れずみの候補も出す＝KM が「売り切れずみ」と出す）",
      s1.j.result === "choose" && s1.j.why === "sibling" && s1.j.candidates.map((c) => c.id).join() === "102,103" && s1.j.candidates.find((c) => c.id === 103).status === "soldout" && (await sake(102)).status === "available", s1.j);
    queue.push(answer({ bottle: true, read: { brand: "田酒", sub_name: "", brewery: "" }, matches: [{ id: 103, confidence: 0.97 }] }));
    const s1b = await photo();
    check("売り切れずみのお酒に、はっきり決まっても、同じ銘柄で売り切れでないお酒があれば、候補を出す", s1b.j.result === "choose" && s1b.j.candidates.map((c) => c.id).join() === "103,102" && (await sake(102)).status === "available", s1b.j);
    await db.execute({ sql: "UPDATE sakes SET status = 'low', soldout_at = '' WHERE id = 103", args: [] });
    // リストに無い番号に、高い確信度を付けている（AI は迷っている）
    queue.push(answer({ bottle: true, read: { brand: "新政", sub_name: "", brewery: "" }, matches: [{ id: 104, confidence: 0.92 }, { id: 104004, confidence: 0.91 }] }));
    const s2 = await photo();
    check("リストに無い番号に、0.5 より高い確信度を付けていたら（次点がいる）、自動では売り切れにしない", s2.j.result === "choose" && s2.j.why === "unsure" && s2.j.candidates.map((c) => c.id).join() === "104" && (await sake(104)).status === "low", s2.j);
    queue.push(answer({ bottle: true, read: { brand: "新政", sub_name: "", brewery: "" }, matches: [{ id: 104004, confidence: 0.99 }, { id: 104, confidence: 0.3 }] }));
    const s2b = await photo();
    check("いちばん上がリストに無い番号なら、リストの次の候補を、自動では売り切れにしない", s2b.j.result === "choose" && (await sake(104)).status === "low", s2b.j);
    // 0〜1 の外の確信度
    queue.push({ kind: "text", text: JSON.stringify({ bottle: true, read: { brand: "飛露喜", sub_name: "", brewery: "" }, matches: [{ id: 109, confidence: 72 }] }) });
    const s3 = await photo();
    check("確信度が 0〜1 の外（72 のような百分率）なら、迷っているとみなす（自動では売り切れにしない）", s3.j.result === "choose" && s3.j.why === "unsure" && (await sake(109)).status === "available", s3.j);
    // 瓶が写っていると言っていない
    queue.push(answer({ bottle: false, read: { brand: "飛露喜", sub_name: "", brewery: "" }, matches: [{ id: 109, confidence: 0.96 }] }));
    const s4 = await photo();
    queue.push({ kind: "text", text: JSON.stringify({ read: { brand: "飛露喜" }, matches: [{ id: 109, confidence: 0.96 }] }) });
    const s4b = await photo();
    check("AI が「瓶が写っている」と、はっきり答えていなければ（false・答えが無い）、自動では売り切れにしない", s4.j.result === "choose" && s4b.j.result === "choose" && (await sake(109)).status === "available", [s4.j, s4b.j]);
    // 銘柄の書き方のちがい・同じ蔵元
    await ins(114, "【限定】而今", "純米 千本錦");
    await ins(115, "亜麻猫", "スパーク", { brewery: "新政酒造株式会社" });
    await ins(116, "作 雅乃智", "純米吟醸");
    await ins(117, "黒竜", "純米吟醸", { brewery: "黒龍酒造" });
    await ins(118, "黒龍", "大吟醸", { brewery: "黒龍酒造" });
    const fam = async (id, others) => {
      queue.push(answer({ bottle: true, read: { brand: "", sub_name: "", brewery: "" }, matches: [{ id, confidence: 0.97 }] }));
      const r = await photo();
      return r.j.result === "choose" && r.j.why === "sibling" && others.every((o) => r.j.candidates.some((c) => c.id === o)) && (await sake(id)).status !== "soldout" ? "" : JSON.stringify(r.j).slice(0, 200);
    };
    const f1 = await fam(101, [114]);
    const f2 = await fam(104, [115]);
    const f3 = await fam(110, [116]);
    const f4 = await fam(118, [117]);
    check("かっこ書き（【限定】而今と而今）・同じ蔵元（新政と亜麻猫・黒龍と黒竜）・頭の語が同じ（作と作 雅乃智）も、同じ銘柄として扱う（自動では売り切れにしない）", !f1 && !f2 && !f3 && !f4, [f1, f2, f3, f4]);
    await db.execute({ sql: "UPDATE sakes SET archived = 1 WHERE id IN (114, 115, 116, 117, 118)", args: [] });
    check("ここまで、控えは 1 行も増えていない", Number((await q("SELECT COUNT(*) AS n FROM kitchen_soldout"))[0].n) === n0);
  }

  // ============================================================================
  // 5. AI が、うまく答えないとき
  // ============================================================================
  {
    const n0 = aiCalls.length;
    // はじめの形を、API が受けつけない（400）→ 前からの形で、もう一度だけ
    queue.push({ kind: "status", status: 400 });
    queue.push({ kind: "text", text: JSON.stringify({ bottle: true, read: { brand: "飛露喜", sub_name: "特別純米", brewery: "" }, matches: [{ id: 109, confidence: 0.95 }] }), model: "claude-opus-4-8" });
    const r = await photo();
    const [c1, c2] = aiCalls.slice(n0);
    check("はじめの形を API が受けつけなかった（400）ときは、ラベル読み取りと同じ前からの形で、もう一度だけ聞く → 売り切れにできる",
      r.j.result === "applied" && r.j.sake.id === 109 && aiCalls.length === n0 + 2 && c1.body.model === "claude-opus-5-5" && c2.body.model === "claude-opus-4-8" && c2.body.fallbacks === undefined && c2.body.output_config === undefined
      && typeof c2.body.system === "string" && /在庫リスト/.test(c2.body.system) && !c2.beta.includes("server-side-fallback"), { r: r.j, m: [c1 && c1.body.model, c2 && c2.body.model] });
    await post({ op: "restore", logId: r.j.logId });
    // 2 回とも 400
    queue.push({ kind: "status", status: 400 }); queue.push({ kind: "status", status: 400 });
    const bad2 = await photo();
    check("それも受けつけなければ、何もしない（502 ai_error）", bad2.status === 502 && bad2.j.error === "ai_error" && (await sake(109)).status === "available", bad2.j);
    const lastPhoto = (await audits("kitchen.photo")).map((x) => JSON.parse(x.payload)).filter((x) => x.result === "applied" && x.model === "claude-opus-4-8").pop();
    check("前からの形で聞き直して売り切れにしたときは、はじめのエラー（API 400）を記録に残す（ずっと続くなら、設定を直せるように）", !!lastPhoto && /はじめの形を受けつけなかった（API 400/.test(String(lastPhoto.note || "")), lastPhoto);
    // 混んでいる（429。retry-after 45 秒）→ 待たずに返す
    const n429 = aiCalls.length;
    queue.push({ kind: "status", status: 429, headers: { "retry-after": "45" } });
    const t429 = Date.now();
    const busy429 = await photo();
    check("AI が混んでいる（429・retry-after 45 秒）ときは、待たずに、やり直さずに返す（502 ai_error。Vercel の 60 秒を超えない）", busy429.status === 502 && busy429.j.error === "ai_error" && Date.now() - t429 < 10_000 && aiCalls.length === n429 + 1, [busy429.j, Date.now() - t429, aiCalls.length - n429]);
    // 断られた
    queue.push({ kind: "refusal" });
    const ref = await photo();
    check("AI が断った（refusal）ときは、中身を読まずに、何もしない（502 ai_refused）", ref.status === 502 && ref.j.error === "ai_refused", ref.j);
    // 鍵が通らない
    const n1 = aiCalls.length;
    queue.push({ kind: "status", status: 401 });
    const un = await photo();
    check("AI の鍵が通らない（401）→ 503 ai_unavailable。やり直さない", un.status === 503 && un.j.error === "ai_unavailable" && aiCalls.length === n1 + 1, [un.j, aiCalls.length - n1]);
    // サーバーの失敗
    const n2 = aiCalls.length;
    queue.push({ kind: "status", status: 500 }); queue.push({ kind: "status", status: 500 });
    const e5 = await photo();
    check("AI の側の失敗（500）は、1 回だけやり直して、だめなら 502 ai_error", e5.status === 502 && e5.j.error === "ai_error" && aiCalls.length === n2 + 2, [e5.j, aiCalls.length - n2]);
    const fails = (await audits("kitchen.photo_failed")).length;
    check("失敗も、記録に残る", fails >= 4, fails);
    if (process.env.SLOW === "1") {
      const n3 = aiCalls.length;
      queue.push({ kind: "slow", ms: 22_000 }); queue.push({ kind: "slow", ms: 22_000 });
      const t0 = Date.now();
      const slow = await photo();
      check("AI が 20 秒返事をしないときは、打ち切る（504 ai_timeout。やり直しは 1 回まで＝長くても 1 分以内）", slow.status === 504 && slow.j.error === "ai_timeout" && Date.now() - t0 < 60_000 && aiCalls.length === n3 + 2, [slow.status, slow.j, Date.now() - t0]);
      queue.length = 0;
      await sleep(3000);
    }
  }

  // ============================================================================
  // 6. おかしい入力（AI には、聞かない）
  // ============================================================================
  {
    const n0 = aiCalls.length;
    const r = [
      await post({ op: "photo", media_type: "image/jpeg" }), await post({ op: "photo", image: IMG, media_type: "image/gif" }), await post({ op: "photo", image: "これは写真ではない", media_type: "image/jpeg" }),
      await post({ op: "photo", image: "A".repeat(2_400_004), media_type: "image/jpeg" }), await post({ op: "nazo" }), await post({ op: "soldout" }), await post({ op: "soldout", sakeId: 99999 }), await post({ op: "soldout", sakeId: 107 }),
    ];
    check("写真が無い・形がちがう・大きすぎる・知らない op・番号が無い・無いお酒・削除ずみのお酒 → どれも断る。AI には 1 回も聞かない",
      r.map((x) => x.status).join() === "400,400,400,413,400,400,404,404" && r.map((x) => x.j.error).join() === "no_image,bad_image_type,bad_image,image_too_large,bad_op,no_sake,not_found,not_found" && aiCalls.length === n0, r.map((x) => [x.status, x.j.error]));
    const dataUrl = await (async () => { queue.push(answer({ bottle: true, read: { brand: "", sub_name: "", brewery: "" }, matches: [] })); return post({ op: "photo", image: "data:image/jpeg;base64," + IMG, media_type: "image/jpeg" }); })();
    check("data: で始まる形の写真も、受ける（頭を外して、中身だけ AI に渡す）", dataUrl.j.result === "none" && aiCalls[aiCalls.length - 1].body.messages[0].content[0].source.data === IMG, dataUrl.j);
  }

  // ============================================================================
  // 7. 一覧から選ぶ・同時に押す・元に戻せないとき
  // ============================================================================
  {
    const [a, b] = await Promise.all([post({ op: "soldout", sakeId: 110 }), post({ op: "soldout", sakeId: 110 })]);
    const l = await logs(110);
    check("2 台が同時に、同じお酒を売り切れにしても、売り切れにするのは 1 回（控えも 1 行）。もう片方は「もう売り切れ」", [a.j.result, b.j.result].sort().join() === "already,applied" && l.length === 1 && l[0].how === "pick" && (await audits("sake.soldout_event")).map((x) => JSON.parse(x.payload)).filter((x) => x.id === 110).length === 1, [a.j, b.j, l.length]);
    const logJ = Number(l[0].id);
    // そのあとで、納品 → また売り切れ（残数 0）になった
    await db.execute({ sql: "UPDATE sakes SET status = 'soldout', soldout_at = datetime('now','localtime','+1 minutes'), stock_count = 0 WHERE id = ?", args: [110] });
    const ch = await post({ op: "restore", logId: logJ });
    check("売り切れにしたあとで、状態が動いていたら（売切日がちがう）、元に戻さない（409 changed）", ch.status === 409 && ch.j.error === "changed" && (await sake(110)).status === "soldout" && (await logs(110))[0].undone_at === "", ch.j);
    check("…そのお酒は、「元に戻す」の所にも出ない", !(await call(URLK)).j.recent.some((x) => x.sake.id === 110));
    // だれかが、もう戻している
    const k1 = await post({ op: "soldout", sakeId: 111 });
    await db.execute({ sql: "UPDATE sakes SET status = 'available', soldout_at = '' WHERE id = ?", args: [111] });
    const ch2 = await post({ op: "restore", logId: k1.j.logId });
    check("在庫ボードで、もう提供中に戻してあるお酒も、同じ（409 changed。開栓日などを書きかえない）", ch2.status === 409 && ch2.j.error === "changed", ch2.j);
    // もう一度売り切れにした → 古いほうの控えでは、戻せない
    const k2 = await post({ op: "soldout", sakeId: 111 });
    const old = await post({ op: "restore", logId: k1.j.logId });
    check("もう一度売り切れにしたら、古いほうの控えでは戻せない（409 changed）。新しいほうで戻せる", k2.j.result === "applied" && old.status === 409 && old.j.error === "changed" && (await post({ op: "restore", logId: k2.j.logId })).j.result === "restored" && (await sake(111)).status === "available", [k2.j, old.j]);
    // 24 時間を過ぎた
    const k3 = await post({ op: "soldout", sakeId: 111 });
    await db.execute({ sql: "UPDATE kitchen_soldout SET created_at = datetime('now','localtime','-25 hours') WHERE id = ?", args: [k3.j.logId] });
    const late = await post({ op: "restore", logId: k3.j.logId });
    check("売り切れにしてから 24 時間を過ぎたら、ここからは戻せない（409 too_old。在庫ボードで戻す）", late.status === 409 && late.j.error === "too_old" && (await sake(111)).status === "soldout" && !(await call(URLK)).j.recent.some((x) => x.sake.id === 111), late.j);
    // 2 台が同時に「元に戻す」を押した
    const k5 = await post({ op: "soldout", sakeId: 109 });
    const [u1, u2] = await Promise.all([post({ op: "restore", logId: k5.j.logId }), post({ op: "restore", logId: k5.j.logId })]);
    check("2 台が同時に「元に戻す」を押しても、戻すのは 1 回。もう片方には「もう戻してある」と返す（「状態が変わった」とは言わない）", [u1.j.result || u1.j.error, u2.j.result || u2.j.error].sort().join() === "already_restored,restored" && (await sake(109)).status === "available", [u1.j, u2.j]);
    // 在庫ボードで、削除 → 復元 → 売切（売切日は、古いまま残る）
    const k6 = await post({ op: "soldout", sakeId: 102 });
    await db.execute({ sql: "UPDATE sakes SET archived = 1, updated_at = datetime('now','localtime','+1 seconds') WHERE id = 102", args: [] });
    await db.execute({ sql: "UPDATE sakes SET archived = 0, status = 'available', updated_at = datetime('now','localtime','+2 seconds') WHERE id = 102", args: [] });
    await db.execute({ sql: "UPDATE sakes SET status = 'soldout', updated_at = datetime('now','localtime','+3 seconds') WHERE id = 102", args: [] });
    const u6 = await post({ op: "restore", logId: k6.j.logId });
    check("KM から売り切れにしたあとで、在庫ボードで削除→復元→売切をしたお酒は、元に戻さない（409 changed。売切日が古いまま同じでも、更新日時で分かる）。「元に戻す」の所にも出ない",
      u6.status === 409 && u6.j.error === "changed" && (await sake(102)).status === "soldout" && !(await call(URLK)).j.recent.some((x) => x.sake.id === 102), u6.j);
    await db.execute({ sql: "UPDATE sakes SET status = 'available', soldout_at = '' WHERE id = 102", args: [] });
    // 売り切れにしたあとで、注文（遅れて届いた）が残数を 0 にした
    const k7 = await post({ op: "soldout", sakeId: 104 });
    await db.execute({ sql: "UPDATE sakes SET stock_count = 0 WHERE id = 104", args: [] });
    const listed7 = (await call(URLK)).j.recent.some((x) => x.sake.id === 104);
    const u7 = await post({ op: "restore", logId: k7.j.logId });
    check("売り切れにしたあとで残数が 0 になったお酒は、「元に戻す」の所に出さない・戻さない（409 changed）", !listed7 && u7.status === 409 && u7.j.error === "changed" && (await sake(104)).status === "soldout", [listed7, u7.j]);
    await db.execute({ sql: "UPDATE sakes SET status = 'low', soldout_at = '', stock_count = 3, opened_at = '2026-11-25 19:30:00' WHERE id = 104", args: [] });
    // 夜の日報: その前の本当の売り切れは、報告する（ここまでの売切イベントを消してから、1 本だけで確かめる）
    await db.execute("DELETE FROM audit_logs WHERE action IN ('sake.soldout_event', 'sake.soldout_undone')");
    await ins(119, "鳳凰美田", "剱 辛口純米", { brewery: "小林酒造" });
    await db.execute({ sql: "INSERT INTO audit_logs (store_id, action, payload, created_at) VALUES (1, 'sake.soldout_event', ?, datetime('now','localtime','-3 hours'))", args: [JSON.stringify({ id: 119, name: "鳳凰美田 剱", days: 5, cups: 18, deliveredAt: "", bottleSize: "1.8L" })] });
    const k8 = await post({ op: "soldout", sakeId: 119 });
    const brMid = await call(`/api/cron/daily-brief?dry=1&token=${CRON}`);
    const u8 = await post({ op: "restore", logId: k8.j.logId });
    const br = await call(`/api/cron/daily-brief?dry=1&token=${CRON}`);
    const houou = (String(br.j.text || "").match(/鳳凰美田/g) || []).length;
    check("夜の日報: KM のまちがいを元に戻しても、その前の本当の売り切れ（3 時間前）は「本日の完売」に残す（外すのは、KM で売り切れにしてから戻すまでのぶんだけ）",
      brMid.j.sections.soldout === 2 && u8.j.result === "restored" && br.j.sections.soldout === 1 && houou === 1, [brMid.j.sections, u8.j, br.j.sections, houou]);
    await db.execute({ sql: "UPDATE sakes SET archived = 1 WHERE id = 119", args: [] });
    // 残数つきのお酒
    const k4 = await post({ op: "soldout", sakeId: 104 });
    const s104 = await sake(104);
    const b4 = await post({ op: "restore", logId: k4.j.logId });
    const s104b = await sake(104);
    check("残数を数えているお酒: 売り切れにしても、残数（3）は変えない。元に戻すと、状態・開栓日・残数とも元どおり", s104.status === "soldout" && Number(s104.stock_count) === 3 && b4.j.result === "restored" && s104b.status === "low" && Number(s104b.stock_count) === 3 && s104b.opened_at === "2026-11-25 19:30:00", [s104, s104b]);
  }

  // ============================================================================
  // 8. 連打の歯止め
  // ============================================================================
  {
    let ok = 0, busy = 0, firstBusy = null;
    const sent0 = aiCalls.length;
    for (let i = 0; i < 45 && !busy; i++) {
      queue.push(answer({ bottle: false, read: { brand: "", sub_name: "", brewery: "" }, matches: [] }));
      const r = await photo();
      if (r.status === 429) { busy++; firstBusy = r.j; queue.pop(); } else if (r.status === 200) ok++;
    }
    const total = aiCalls.length; // ここまでに AI に聞いた回数は、歯止めより多いことがある（やり直しのぶん）
    check("写真の読み取りは、10 分に 40 枚まで（超えたら 429 busy。AI には聞かない）", busy === 1 && firstBusy.error === "busy" && ok > 0 && ok <= 40 && total >= sent0, { ok, busy, firstBusy });
  }

  check("にせものの AI に届いた鍵は、テスト用のものだけ", aiCalls.length > 0 && aiCalls.every((c) => c.key === AI_KEY));
  console.log(`${pass} passed, ${fail} failed`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); cleanup(); process.exit(1); });
