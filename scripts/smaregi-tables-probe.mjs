// テーブルID(卓番号→内部ID)とカテゴリの取得口を探す。読み取りのみ。
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
  body: new URLSearchParams({ grant_type: "client_credentials", scope: "waiter.stores:read waiter.menus:read waiter.orders:read waiter.orders:history" }),
});
const token = (await tokRes.json()).access_token;

async function get(p) {
  const res = await fetch(`${API}/${p}`, { headers: { Authorization: `Bearer ${token}` } });
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, j, raw: t };
}

const candidates = [
  "waiter/stores/2/tables",
  "waiter/tables",
  "waiter/stores/2/seats",
  "waiter/seats",
  "waiter/store_tables",
  "waiter/stores/2",
  "waiter/categories",
  "waiter/stores/2/categories",
];
for (const p of candidates) {
  const r = await get(p);
  console.log(`\n--- GET ${p} → ${r.status}`);
  if (r.status === 200) {
    const arr = Array.isArray(r.j) ? r.j : [r.j];
    if (arr[0]) console.log("  キー:", Object.keys(arr[0]).join(", "));
    console.log("  ", JSON.stringify(arr.slice(0, 3), null, 0).slice(0, 700));
  } else {
    console.log("  ", String(r.raw).slice(0, 150));
  }
}
