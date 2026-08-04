// 在庫エンジン用：読み取り専用の調査（書き込み/注文は一切しない）
// 確認内容: ①モバイルオーダーのメニュー全件(waiter/menus・ページング) ②カテゴリ ③取引明細(販売数)が取れるか＋scope
// 使い方: node scripts/smaregi-inventory-probe.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".smaregi.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const contract = env.SMAREGI_CONTRACT_ID;
const clientId = env.SMAREGI_CLIENT_ID;
const secret = env.SMAREGI_CLIENT_SECRET;
const isProd = (env.SMAREGI_ENV || "prod") === "prod";
const ID_HOSTS = isProd ? ["id.smaregi.jp", "id.smaregi.com"] : ["id.smaregi.dev"];
const API_BASE = isProd ? "https://api.smaregi.jp" : "https://api.smaregi.dev";

console.log("契約:", contract, "| 環境:", isProd ? "本番" : "サンドボックス");

async function getToken(scopes) {
  const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");
  for (const host of ID_HOSTS) {
    const url = `https://${host}/app/${contract}/token`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: scopes }),
      });
      const text = await res.text();
      if (res.ok) { const j = JSON.parse(text); return { token: j.access_token, scope: j.scope }; }
      console.log(`  token @ ${host} → ${res.status}: ${text.slice(0, 200)}`);
    } catch (e) { console.log(`  token @ ${host} → 接続失敗: ${e.message}`); }
  }
  return {};
}

async function get(token, p) {
  const url = `${API_BASE}/${contract}/${p}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ========== ① メニュー＋カテゴリ ==========
console.log("\n===== ① モバイルオーダー メニュー =====");
const t1 = await getToken("waiter.menus:read waiter.stores:read pos.products:read");
if (!t1.token) { console.log("❌ トークン取得失敗"); process.exit(1); }
console.log("発行scope:", t1.scope);

// カテゴリ
const cat = await get(t1.token, "waiter/categories?limit=100");
const catMap = {};
if (Array.isArray(cat.body)) cat.body.forEach((c) => { catMap[c.categoryId] = c.name; });
console.log(`waiter/categories → ${cat.status} / ${Array.isArray(cat.body) ? cat.body.length : "?"}件`);

// メニュー全ページ
let menus = [];
for (let page = 1; page <= 20; page++) {
  const r = await get(t1.token, `waiter/menus?limit=100&page=${page}`);
  if (r.status !== 200 || !Array.isArray(r.body) || r.body.length === 0) { if (page === 1) console.log("waiter/menus →", r.status, JSON.stringify(r.body).slice(0,200)); break; }
  menus = menus.concat(r.body);
  if (r.body.length < 100) break;
}
console.log(`waiter/menus → 合計 ${menus.length}件`);
if (menus.length) {
  const sake = menus.filter((m) => /日本酒|地酒/.test(m.name) || m.isOpenPrice);
  const byCat = {};
  menus.forEach((m) => { const k = `${m.categoryId}:${catMap[m.categoryId] || "?"}`; (byCat[k] = byCat[k] || []).push(m.name); });
  console.log("\n-- カテゴリ別件数 --");
  Object.entries(byCat).sort().forEach(([k, arr]) => console.log(`  [${k}] ${arr.length}件: ${arr.slice(0, 6).join(" / ")}${arr.length > 6 ? " …" : ""}`));
  console.log(`\n-- 日本酒/オープン価格(除外候補) ${sake.length}件 --`);
  sake.forEach((m) => console.log(`  id=${m.id} ${m.name} openPrice=${m.isOpenPrice} cat=${m.categoryId}`));
  console.log("\n-- メニュー サンプル(先頭8・キー確認) --");
  menus.slice(0, 8).forEach((m) => console.log("  ", JSON.stringify({ id: m.id, name: m.name, categoryId: m.categoryId, price: m.prices?.[0]?.amount ?? m.price, isOpenPrice: m.isOpenPrice })));
}

// ========== ② 取引明細（販売数） ==========
console.log("\n===== ② 取引明細（販売数が取れるか） =====");
const t2 = await getToken("pos.transactions:read");
if (!t2.token) {
  console.log("⚠️ pos.transactions:read のトークンが取れない＝アプリにこのscopeが未付与の可能性。デベロッパーズでscope追加が必要かも。");
} else {
  console.log("発行scope:", t2.scope);
  const tr = await get(t2.token, "pos/transactions?limit=3");
  console.log(`pos/transactions?limit=3 → ${tr.status}`);
  if (tr.status === 200 && Array.isArray(tr.body)) {
    console.log(`  取引 ${tr.body.length}件 取得。サンプルキー:`, Object.keys(tr.body[0] || {}).slice(0, 20).join(", "));
    const head = tr.body[0];
    const headId = head?.transactionHeadId || head?.transactionId;
    console.log("  先頭取引:", JSON.stringify({ id: headId, date: head?.transactionDateTime, total: head?.total }));
    if (headId) {
      const det = await get(t2.token, `pos/transactions/${headId}/details`);
      console.log(`  pos/transactions/${headId}/details → ${det.status}`);
      if (det.status === 200 && Array.isArray(det.body)) {
        console.log(`    明細 ${det.body.length}行。サンプル:`);
        det.body.slice(0, 5).forEach((d) => console.log("    ", JSON.stringify({ productId: d.productId, name: d.productName, qty: d.quantity, price: d.price })));
      }
    }
  } else {
    console.log("  応答:", JSON.stringify(tr.body).slice(0, 300));
  }
  // 取引明細の横断一覧も試す
  const td = await get(t2.token, "pos/transactionDetails?limit=3");
  console.log(`pos/transactionDetails?limit=3 → ${td.status}`);
}
console.log("\n=== 調査おわり（読み取りのみ・書き込みなし）===");
