// 注文連携の設計用：ウェイターのテーブル利用・注文・メニューの実構造を読み取り専用で調査。
// 注文は一切投げない。使い方: node scripts/smaregi-order-probe.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".smaregi.env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const contract = env.SMAREGI_CONTRACT_ID;
const API = `https://api.smaregi.jp/${contract}`;
const basic = Buffer.from(`${env.SMAREGI_CLIENT_ID}:${env.SMAREGI_CLIENT_SECRET}`).toString("base64");

const SCOPE = "pos.products:read waiter.menus:read waiter.orders:read waiter.orders:history waiter.stores:read";
const tokRes = await fetch(`https://id.smaregi.jp/app/${contract}/token`, {
  method: "POST",
  headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }),
});
const tokJson = await tokRes.json();
const token = tokJson.access_token;
console.log("token →", tokRes.status, "| 付与スコープ:", tokJson.scope || "(不明)");
if (!token) { console.log("❌ トークン失敗:", JSON.stringify(tokJson).slice(0, 300)); process.exit(1); }

async function req(method, p, body) {
  const res = await fetch(`${API}/${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, j, raw: t };
}
const get = (p) => req("GET", p);

function dump(label, r, n = 2) {
  console.log(`\n===== ${label} → ${r.status} =====`);
  if (r.status !== 200) { console.log("  ", String(r.raw).slice(0, 220)); return; }
  if (Array.isArray(r.j)) {
    console.log(`件数: ${r.j.length}`);
    if (r.j[0]) console.log("先頭キー:", Object.keys(r.j[0]).join(", "));
    console.log(JSON.stringify(r.j.slice(0, n), null, 1).slice(0, 1400));
  } else {
    console.log(JSON.stringify(r.j, null, 1)?.slice(0, 1400));
  }
}

// 1. 店舗
dump("waiter/stores", await get("waiter/stores"));

// 2. メニュー（日本酒が反映されているか・menuId/categoryId/価格の構造）
const menus = await get("waiter/menus");
dump("waiter/menus", menus, 3);
if (Array.isArray(menus.j)) {
  const sake = menus.j.filter((m) => /SLIB|日本酒|純米|吟醸|大吟醸/.test((m.name || "") + (m.productCode || "")));
  console.log(`\n  ↑メニュー内で日本酒っぽい候補: ${sake.length}件`,
    sake.slice(0, 5).map((m) => `${m.menuId || m.id}:${m.name}`).join(" / "));
}

// 3. カテゴリ
dump("waiter/menu_categories", await get("waiter/menu_categories"), 5);

// 4. テーブル利用一覧（アクティブな卓・構造・既存注文の有無）
const tu = await get("waiter/table_uses");
dump("waiter/table_uses (一覧)", tu, 3);

// 5. 既存のテーブル利用があれば、その注文構造を読む（注文ボディの逆引き）
if (Array.isArray(tu.j) && tu.j[0]) {
  const id = tu.j[0].tableUseId || tu.j[0].id;
  if (id) {
    dump(`waiter/table_uses/${id}`, await get(`waiter/table_uses/${id}`));
    dump(`waiter/table_uses/${id}/orders (既存注文の構造)`, await get(`waiter/table_uses/${id}/orders`), 3);
  }
}

// 6. POS商品（smaregi_product_id → menuId の対応確認用）
dump("pos/products (先頭3)", await get("pos/products?limit=3"), 3);

console.log("\n--- 完了（読み取りのみ・注文は投げていない）---");
