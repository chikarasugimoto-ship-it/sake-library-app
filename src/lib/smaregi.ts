// スマレジ・プラットフォームAPI クライアント（サーバー専用）。
// 認証情報は環境変数（ローカルは .smaregi.env を起動時に読み込み or Vercel env）。
import type { Sake } from "./types";

const CONTRACT = () => process.env.SMAREGI_CONTRACT_ID || "";
const CLIENT_ID = () => process.env.SMAREGI_CLIENT_ID || "";
const SECRET = () => process.env.SMAREGI_CLIENT_SECRET || "";
const IS_PROD = () => (process.env.SMAREGI_ENV || "prod") !== "sandbox";
const ID_HOST = () => (IS_PROD() ? "id.smaregi.jp" : "id.smaregi.dev");
const API_BASE = () => (IS_PROD() ? "https://api.smaregi.jp" : "https://api.smaregi.dev");
// 日本酒を入れるPOSカテゴリ（既定: 日本酒=8000001。酒=5 にすればウェイター表示済みカテゴリ）
const SAKE_CATEGORY = () => process.env.SMAREGI_SAKE_CATEGORY_ID || "8000001";
// ウェイターの店舗ID（waiter/stores の id。すぎだま=2）。POS店舗IDとは別物
const WAITER_STORE = () => process.env.SMAREGI_WAITER_STORE_ID || "2";

// 卓名 → スマレジ内部テーブルID。注文APIの本物IDは小さい連番（QRのURL内ID 9624等とは別物）。
// アクティブ卓で実測確認: B2=14 / C1=15 / C2=16。並び順 A1,A2,B1,B2,C1,C2,K1..K13 から連番(11〜29)で確定。
// ※アクティブな卓は名前(K13等)で照合されるのでこの表は未着席卓のチェックイン時のみ使用。
export const TABLE_IDS: Record<string, string> = {
  A1: "11", A2: "12", B1: "13", B2: "14", C1: "15", C2: "16",
  K1: "17", K2: "18", K3: "19", K4: "20", K5: "21", K6: "22",
  K7: "23", K8: "24", K9: "25", K10: "26", K11: "27", K12: "28", K13: "29",
};
export const TABLE_NAMES = Object.keys(TABLE_IDS); // 表示順 A1,A2,B1,B2,C1,C2,K1..K13

export function smaregiConfigured() {
  return !!(CONTRACT() && CLIENT_ID() && SECRET());
}

// 注文連携の本番投入ガード（既定OFF）。営業時間外テストで "1" にして有効化する
export function orderingEnabled() {
  return process.env.SMAREGI_ORDERING_ENABLED === "1";
}

// トークンはスコープ別にキャッシュ（pos用とwaiter用を取り違えて403になるのを防ぐ）
const _tokens = new Map<string, { value: string; exp: number }>();

async function getToken(scope: string): Promise<string> {
  const cached = _tokens.get(scope);
  if (cached && cached.exp > Date.now() + 30_000) return cached.value;
  const basic = Buffer.from(`${CLIENT_ID()}:${SECRET()}`).toString("base64");
  const res = await fetch(`https://${ID_HOST()}/app/${CONTRACT()}/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });
  if (!res.ok) throw new Error(`smaregi token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  _tokens.set(scope, { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

async function api<T = unknown>(method: string, path: string, body?: unknown, scope = "pos.products:read pos.products:write"): Promise<T> {
  const token = await getToken(scope);
  const res = await fetch(`${API_BASE()}/${CONTRACT()}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`smaregi ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as T) : (null as T);
}

// 商品名は「銘柄（＋特定名称）」。価格は税込想定（taxDivision=0）
function productName(sake: Sake): string {
  return [sake.brand, sake.grade].filter(Boolean).join(" ").slice(0, 60) || sake.brand;
}

// 日本酒をスマレジ商品として作成し、productId を返す
export async function createSakeProduct(sake: Sake): Promise<string> {
  const created = await api<{ productId: string }>("POST", "pos/products", {
    categoryId: SAKE_CATEGORY(),
    productCode: `SLIB${sake.id}`,
    productName: productName(sake),
    productKana: "",
    taxDivision: "0",
    productPriceDivision: "1",
    price: String(sake.price ?? 0),
  });
  return created.productId;
}

// 商品名・価格の更新（編集時用）
export async function updateSakeProduct(productId: string, sake: Sake): Promise<void> {
  await api("PATCH", `pos/products/${productId}`, {
    productName: productName(sake),
    price: String(sake.price ?? 0),
  });
}

// 削除
export async function deleteSakeProduct(productId: string): Promise<void> {
  await api("DELETE", `pos/products/${productId}`);
}

// ===== ウェイター 注文連携 =====
// スコープ: 一覧=waiter.orders:history / 作成・注文=waiter.orders:write / メニュー=waiter.menus:read

export type WaiterTable = { id: string; name: string };
export type TableUse = {
  id: string;
  storeId: string;
  tables: WaiterTable[];
  number: number;
  status: string; // started | ended | canceled | merged
};

type WaiterPrice = { taxRate: number; taxType: string; amount: string; tax: string; primary?: boolean };
type WaiterMenu = { id: string; name: string; categoryId: string; isOpenPrice: boolean; prices: WaiterPrice[]; sortNo?: number; note?: string };

// 卓名の表記ゆれ吸収。店の卓名はアルファベット＋数字（C1, B2, K4…）なので
// 数字だけ抜き出すと A1/B1/C1 が全部"1"に衝突する。大文字化＋英数字以外を除去して完全一致で比較。
function normTable(name: string): string {
  return String(name ?? "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// アクティブな（着席中の）テーブル利用一覧
export async function listActiveTableUses(): Promise<TableUse[]> {
  const qs = new URLSearchParams({ store_id: WAITER_STORE(), status: "started", limit: "100" });
  const r = await api<TableUse[]>("GET", `waiter/table_uses?${qs}`, undefined, "waiter.orders:history");
  return Array.isArray(r) ? r : [];
}

// 卓番号に対応するアクティブなテーブル利用を探す（同卓集約のため）
export async function findActiveTableUse(tableNumber: string): Promise<TableUse | null> {
  const want = normTable(tableNumber);
  const uses = await listActiveTableUses();
  return (
    uses.find((u) => (u.tables || []).some((t) => normTable(t.name) === want)) ?? null
  );
}

// 新規チェックイン（その卓にアクティブ利用が無い場合）。tableId はスマレジ内部のテーブルID
export async function createTableUse(tableId: string, guests = 1): Promise<TableUse> {
  return api<TableUse>(
    "POST",
    "waiter/table_uses",
    { storeId: WAITER_STORE(), tables: [{ id: String(tableId), number: guests }], number: guests },
    "waiter.orders:write"
  );
}

export type OrderItemInput = { menuId: string; quantity: number; name?: string; sellingPrice: WaiterPrice2 };
export type WaiterPrice2 = {
  amount: string;
  tax: "included" | "excluded" | "none";
  taxRate: number;
  taxType: "normal" | "reduced" | "none";
};

// テーブル利用に注文を追加（キッチンモニターへ反映）
export async function placeOrder(tableUseId: string, items: OrderItemInput[]): Promise<{ orderId: string }> {
  // orderPrints は任意。キッチン「モニター」は注文登録だけで反映されるため既定では送らない
  // （紙のキッチン伝票が必要なら別途 store/print/{storeId}/kitchen_ticket を呼ぶ）
  return api<{ orderId: string }>(
    "POST",
    `waiter/table_uses/${tableUseId}/orders`,
    { items },
    "waiter.orders:write"
  );
}

// ウェイターのメニューカテゴリ（酒/ソフトドリンク/一品料理/スピード/コース/お通し 等）。
export type WaiterCategory = { id: string; name: string; abbr: string; sortNo: number; parentId: string | null };
export async function listWaiterCategories(): Promise<WaiterCategory[]> {
  const r = await api<WaiterCategory[]>("GET", `waiter/categories?limit=100`, undefined, "waiter.menus:read");
  return Array.isArray(r) ? r : [];
}

// ウェイターのメニュー一覧（menuId と販売価格の解決に使う）。
// limit上限(100)を超えると先頭ページしか返らないため、ページングで全件取得する。
export async function listWaiterMenus(): Promise<WaiterMenu[]> {
  const out: WaiterMenu[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await api<WaiterMenu[]>("GET", `waiter/menus?limit=100&page=${page}`, undefined, "waiter.menus:read");
    if (!Array.isArray(r) || r.length === 0) break;
    out.push(...r);
    if (r.length < 100) break;
  }
  return out;
}

// メニュー価格 → 注文の sellingPrice 形式に変換
function toSellingPrice(p: WaiterPrice): WaiterPrice2 {
  const tax = p.tax === "include" ? "included" : p.tax === "exclude" ? "excluded" : "none";
  const taxType = p.taxType === "reduced" ? "reduced" : p.taxType === "none" ? "none" : "normal";
  return { amount: String(p.amount), tax, taxRate: Number(p.taxRate) || 10, taxType };
}

// 方式A：オープン価格の「日本酒」メニュー1つを使い、注文時に銘柄名・価格を送る。
// 店はウェイターに「日本酒（アプリ注文）」をオープン価格で1つ作るだけ。新銘柄も設定不要。
export function resolveSakeMenu(menus: WaiterMenu[]): { menuId: string; taxRate: number; taxType: "normal" | "reduced" | "none" } | null {
  const envId = process.env.SMAREGI_SAKE_MENU_ID;
  let m: WaiterMenu | undefined;
  if (envId) m = menus.find((x) => String(x.id) === String(envId));
  if (!m) m = menus.find((x) => x.isOpenPrice && /日本酒/.test(x.name));
  if (!m) m = menus.find((x) => /日本酒/.test(x.name)); // 名前だけでも拾う（オープン価格推奨）
  if (!m) return null;
  const p = m.prices?.find((x) => x.primary) || m.prices?.[0];
  const taxType = p?.taxType === "reduced" ? "reduced" : p?.taxType === "none" ? "none" : "normal";
  return { menuId: String(m.id), taxRate: Number(p?.taxRate) || 10, taxType };
}

// 注文明細に出す銘柄名（キッチン表示用）。例「酔鯨 純米吟醸」
export function sakeOrderName(sake: { brand: string; grade?: string }): string {
  return [sake.brand, sake.grade].filter(Boolean).join(" ").slice(0, 85) || sake.brand;
}

// ウェイターに登録すべき銘柄メニュー名（会計レシートにこの名前で出る）。例「上喜元 特別純米」
// resolveMenuFor の名前照合と必ず一致させること（連携状況表示と注文ルートで同じ基準にするため）。
export function waiterMenuName(sake: { brand: string; grade?: string }): string {
  return [sake.brand, sake.grade].filter(Boolean).join(" ").trim();
}

export type ResolvedMenu = { menuId: string; name: string; sellingPrice: WaiterPrice2 };

// 日本酒（smaregi_product_id / 商品名）→ ウェイターの menuId と販売価格 を解決。
// 一致は (1) product_id（メニュー反映後は menu.id == POS productId） (2) メニュー名の完全一致 のみ。
// ※ startsWith(brand) の曖昧一致は使わない（上喜元 特別純米／上喜元 純米 を取り違え、会計が別銘柄に化けるため）。
// オープン価格メニュー（価格行なし）でも解決する＝店はウェイターに「銘柄名のオープン価格メニュー」を作るだけでよく、
// 価格・税はアプリが注文時に送るのでウェイター側の価格管理は不要。
export function resolveMenuFor(
  menus: WaiterMenu[],
  sake: { smaregiProductId?: string; brand: string; grade?: string }
): ResolvedMenu | null {
  let m: WaiterMenu | undefined;
  if (sake.smaregiProductId) m = menus.find((x) => String(x.id) === String(sake.smaregiProductId));
  if (!m) m = menus.find((x) => x.name === waiterMenuName(sake));
  if (!m) return null;
  const price = m.prices?.find((p) => p.primary) || m.prices?.[0];
  // オープン価格は価格行が無いことがある。税は標準10%・税込を既定に（金額は注文時にアプリ側で上書き）
  const sellingPrice = price ? toSellingPrice(price) : { amount: "0", tax: "included" as const, taxRate: 10, taxType: "normal" as const };
  return { menuId: String(m.id), name: m.name, sellingPrice };
}
