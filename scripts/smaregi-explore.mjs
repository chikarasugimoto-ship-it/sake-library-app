// 注文連携の設計用：メニュー/商品/カテゴリ/テーブルの実データ構造を読み取って表示（読み取りのみ）
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
const tokRes = await fetch(`https://id.smaregi.jp/app/${contract}/token`, {
  method: "POST",
  headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", scope: "pos.products:read waiter.menus:read waiter.orders:read waiter.stores:read" }),
});
const token = (await tokRes.json()).access_token;

async function get(p) {
  const res = await fetch(`${API}/${p}`, { headers: { Authorization: `Bearer ${token}` } });
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, j };
}

function show(label, r) {
  console.log(`\n===== ${label} (${r.status}) =====`);
  const sample = Array.isArray(r.j) ? r.j[0] : (r.j && r.j.length ? r.j[0] : r.j);
  if (Array.isArray(r.j)) console.log(`件数: ${r.j.length} / 先頭1件のキー:`, sample ? Object.keys(sample).join(", ") : "(空)");
  console.log(JSON.stringify(sample, null, 1)?.slice(0, 900));
}

show("POS商品", await get("pos/products?limit=1"));
show("ウェイター メニュー", await get("waiter/menus?limit=1"));
show("ウェイター カテゴリー", await get("waiter/menu_categories?limit=3"));
show("ウェイター 店舗", await get("waiter/stores"));
// テーブル候補をいくつか試す
for (const p of ["waiter/tables", "waiter/seats", "waiter/table_seatings", "waiter/store_tables"]) {
  const r = await get(p);
  console.log(`\n--- 試行 GET ${p} → ${r.status}`);
  if (r.status === 200) console.log(JSON.stringify(Array.isArray(r.j) ? r.j.slice(0, 2) : r.j, null, 1)?.slice(0, 600));
  else console.log(String(JSON.stringify(r.j)).slice(0, 160));
}
