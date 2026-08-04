// スマレジ認証＆読み取り疎通テスト（注文は投げない）
// 使い方: node scripts/smaregi-test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, ".smaregi.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const contract = env.SMAREGI_CONTRACT_ID;
const clientId = env.SMAREGI_CLIENT_ID;
const secret = env.SMAREGI_CLIENT_SECRET;
const isProd = (env.SMAREGI_ENV || "prod") === "prod";
const ID_HOSTS = isProd ? ["id.smaregi.jp", "id.smaregi.com"] : ["id.smaregi.dev"];
const API_BASE = isProd ? "https://api.smaregi.jp" : "https://api.smaregi.dev";
const SCOPES = "pos.products:read waiter.menus:read waiter.orders:read waiter.stores:read";

console.log("契約:", contract, "| 環境:", isProd ? "本番" : "サンドボックス");

async function getToken() {
  const basic = Buffer.from(`${clientId}:${secret}`).toString("base64");
  for (const host of ID_HOSTS) {
    const url = `https://${host}/app/${contract}/token`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPES }),
      });
      const text = await res.text();
      console.log(`token @ ${host} → ${res.status}`);
      if (res.ok) return JSON.parse(text).access_token;
      console.log("  応答:", text.slice(0, 300));
    } catch (e) {
      console.log(`token @ ${host} → 接続失敗: ${e.message}`);
    }
  }
  return null;
}

async function get(token, p) {
  const url = `${API_BASE}/${contract}/${p}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  console.log(`GET ${p} → ${res.status}`);
  if (!res.ok) { console.log("  応答:", text.slice(0, 250)); return null; }
  try { return JSON.parse(text); } catch { return text; }
}

const token = await getToken();
if (!token) { console.log("❌ トークン取得に失敗。アクティベート/権限/契約IDを確認"); process.exit(1); }
console.log("✅ トークン取得OK");

const prods = await get(token, "pos/products?limit=3");
if (Array.isArray(prods)) console.log("  商品件数(先頭3):", prods.length, prods.map((x) => x.productName || x.productId).join(" / "));

const stores = await get(token, "waiter/stores");
if (Array.isArray(stores)) console.log("  ウェイター店舗:", stores.length, "件");

const menus = await get(token, "waiter/menus");
if (Array.isArray(menus)) console.log("  ウェイターメニュー:", menus.length, "件");
