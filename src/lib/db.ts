import { createClient, type Client, type InArgs } from "@libsql/client";
import path from "path";
import fs from "fs";

let _client: Client | null = null;
let _ready: Promise<void> | null = null;

function getClient(): Client {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  if (url) {
    _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  } else {
    const dir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    _client = createClient({
      url: "file:" + path.join(process.cwd(), "data", "sake-library.db").replace(/\\/g, "/"),
    });
  }
  return _client;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL DEFAULT 'sugidama',
    name TEXT NOT NULL DEFAULT '煮干しと日本酒 すぎだま',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS sakes (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL DEFAULT 1,
    brand TEXT NOT NULL,
    sub_name TEXT DEFAULT '',
    brewery TEXT DEFAULT '',
    prefecture TEXT DEFAULT '',
    grade TEXT DEFAULT '',
    price INTEGER,
    volume TEXT DEFAULT '90ml',
    description TEXT DEFAULT '',
    taste_tags TEXT DEFAULT '[]',
    pairings TEXT DEFAULT '[]',
    taste_chart TEXT DEFAULT '{}',
    season_label TEXT DEFAULT '',
    is_hidden INTEGER DEFAULT 0,
    photo BLOB,
    photo_type TEXT DEFAULT '',
    label_color TEXT DEFAULT '#1e3d2f',
    status TEXT NOT NULL DEFAULT 'available',
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL DEFAULT 1,
    action TEXT NOT NULL,
    payload TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `INSERT INTO stores (id, slug, name)
     SELECT 1, 'sugidama', '煮干しと日本酒 すぎだま'
     WHERE NOT EXISTS (SELECT 1 FROM stores WHERE id = 1)`,
  // 2026-10-01: 図鑑・会員・酒神・隠し酒プレゼント・ランキングをやめた。以前の表（members / member_tasted /
  // guests / guest_tasted / gods / god_owned / reward_grants など）は本番DBに残っているが、もう読み書きしない。
  // 価格・原価などの設定（キーバリュー）
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`,
  // スタッフ（個別ログイン）。role: admin=管理者(スタッフ管理可) / staff=一般
  `CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'staff',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    last_login TEXT DEFAULT ''
  )`,
  // 卓番号 → スマレジ内部テーブルID の対応（テーブルマスタAPIが無いため、
  // アクティブなテーブル利用を観測して自動学習する。チェックイン作成に使う）
  `CREATE TABLE IF NOT EXISTS table_map (
    table_number TEXT PRIMARY KEY,
    smaregi_table_id TEXT NOT NULL,
    table_name TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  // MO（モバイルオーダー）から受け取った日本酒注文の冪等キー（/api/order/consume）。
  // 同じMO注文を二度受けても残数を二重に減らさないためだけの表。
  `CREATE TABLE IF NOT EXISTS mo_consumed (
    ext_ref TEXT PRIMARY KEY,
    payload TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
];

// 後付けカラム（既存DBにも安全に追加。失敗＝既に存在は無視）
const MIGRATIONS = [
  "ALTER TABLE sakes ADD COLUMN smaregi_product_id TEXT DEFAULT ''",
  // 仕入れ・原価まわり（納品書スキャンで自動入力）
  "ALTER TABLE sakes ADD COLUMN cost_excl_tax INTEGER",
  "ALTER TABLE sakes ADD COLUMN bottle_size TEXT DEFAULT '1.8L'",
  "ALTER TABLE sakes ADD COLUMN kubun TEXT DEFAULT '通常'",
  // 納品日・売切日（消化日数の算出用）／一括取込の目印
  "ALTER TABLE sakes ADD COLUMN delivered_at TEXT DEFAULT ''",
  "ALTER TABLE sakes ADD COLUMN soldout_at TEXT DEFAULT ''",
  "ALTER TABLE sakes ADD COLUMN imported INTEGER DEFAULT 0",
  // 残数（手動設定・NULL=未設定で従来どおり状態のみ運用。0で自動売切）
  "ALTER TABLE sakes ADD COLUMN stock_count INTEGER",
  // 初心者おすすめ（店が指定する「今日の3本」キュレーション。1=おすすめ）
  "ALTER TABLE sakes ADD COLUMN is_beginner INTEGER DEFAULT 0",
  // 開栓日時（生酒など鮮度が落ちやすい酒の「開けたて・お早めに」用。最初の注文で記録し、売切/補充でリセット）
  "ALTER TABLE sakes ADD COLUMN opened_at TEXT DEFAULT ''",
  // 鮮度枠の手動上書き（NULL=自動判定 / 1=必ず開けたて枠に出す / 0=出さない）
  "ALTER TABLE sakes ADD COLUMN fresh_flag INTEGER",
  // 画像のCDN(Blob)URL。設定済みなら /api/photo はここへリダイレクト＝DBのBLOB読み出しを回避。
  "ALTER TABLE sakes ADD COLUMN photo_url TEXT DEFAULT ''",
  // 英訳（インバウンド対応）。i18n は {\"en\":{brand,subName,brewery,prefecture,grade,description,tasteTags,pairings}} のJSON。
  "ALTER TABLE sakes ADD COLUMN i18n TEXT DEFAULT ''",
  // ===== 索引（2026-06-22・PK以外ゼロだった全件スキャンを緩和。列追加ALTERの後に張る）=====
  "CREATE INDEX IF NOT EXISTS idx_sakes_store_archived ON sakes(store_id, archived, sort_order)",
  "CREATE INDEX IF NOT EXISTS idx_sakes_smaregi ON sakes(smaregi_product_id)",
  // ===== 記録強化（2026-08-14）=====
  // 納品日が空の既存銘柄は登録日時(created_at)で補完＝全銘柄で「いつ入ったか」を必ず持つ（冪等・2回目以降は対象0件）
  "UPDATE sakes SET delivered_at = COALESCE(created_at, datetime('now','localtime')) WHERE delivered_at IS NULL OR delivered_at = ''",
  // 杯数集計・日報の既読管理が audit_logs を action で引くための索引
  "CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, id)",
  // ===== 1合・熱燗対応（2026-08-16）=====
  // 熱燗可フラグ（銘柄ごと・在庫ボードでトグル）。1=熱燗OK（1合徳利のみ）。既定0=熱燗不可
  "ALTER TABLE sakes ADD COLUMN kan_ok INTEGER DEFAULT 0",
];

async function init() {
  const c = getClient();
  for (const sql of SCHEMA) await c.execute(sql);
  for (const sql of MIGRATIONS) {
    try {
      await c.execute(sql);
    } catch {
      // カラム既存などは無視
    }
  }
  // ===== 一度きりのデータ移行（settingsに実行記録を残し、再実行しない）=====
  // 2026-08-18 杉本さん指示「（在庫ボードのボタンを押さなくても）すべての銘柄を熱燗可にしてほしい」。
  // 起動のたびに走らせると、後から個別トグルでOFFにした銘柄が勝手にONへ戻ってしまうため、
  // 実行済みフラグ付きの一度きり移行にする（以後のON/OFFは在庫ボードのボタン・トグルで）。
  try {
    const done = await c.execute({
      sql: "SELECT value FROM settings WHERE key = 'once_kan_all_on_2026_08_18'",
      args: [],
    });
    if (done.rows.length === 0) {
      const r = await c.execute("UPDATE sakes SET kan_ok = 1 WHERE archived = 0");
      await c.execute({
        sql: "INSERT INTO settings (key, value) VALUES ('once_kan_all_on_2026_08_18', ?) ON CONFLICT(key) DO NOTHING",
        args: [`applied changed=${r.rowsAffected}`],
      });
    }
  } catch {
    // 移行失敗は致命的でない（次回起動時に再挑戦される）
  }
}

function ready(): Promise<void> {
  if (!_ready) {
    // 【重要】失敗した init をキャッシュしない（MO側と同じ修正）。
    // init が一度失敗するとこのインスタンスは rejected Promise を持ち続け、以後のリクエストが
    // 全部 "Application error"(500) になるため、①300ms置いて1回再試行 ②最終失敗時は _ready を
    // 破棄して次のリクエストで再挑戦できるようにする（壊れたまま固定しない）。
    _ready = (async () => {
      try {
        await init();
      } catch {
        await new Promise((r) => setTimeout(r, 300));
        await init();
      }
    })().catch((e) => {
      _ready = null;
      throw e;
    });
  }
  return _ready;
}

export async function all<T = Record<string, unknown>>(sql: string, args: InArgs = []): Promise<T[]> {
  await ready();
  const res = await getClient().execute({ sql, args });
  return res.rows as unknown as T[];
}

export async function get<T = Record<string, unknown>>(sql: string, args: InArgs = []): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] ?? null;
}

export async function run(
  sql: string,
  args: InArgs = []
): Promise<{ lastInsertRowid: number | null; rowsAffected: number }> {
  await ready();
  const res = await getClient().execute({ sql, args });
  return {
    lastInsertRowid: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : null,
    rowsAffected: Number(res.rowsAffected) || 0,
  };
}

export async function audit(action: string, payload: unknown) {
  try {
    await run("INSERT INTO audit_logs (store_id, action, payload) VALUES (1, ?, ?)", [
      action,
      JSON.stringify(payload ?? "").slice(0, 2000),
    ]);
  } catch {
    // 監査ログの失敗で本処理を止めない
  }
}

export type SakeRow = {
  id: number;
  brand: string;
  sub_name: string;
  brewery: string;
  prefecture: string;
  grade: string;
  price: number | null;
  volume: string;
  description: string;
  taste_tags: string;
  pairings: string;
  taste_chart: string;
  season_label: string;
  is_hidden: number;
  has_photo?: number;
  photo_type: string;
  label_color: string;
  status: string;
  sort_order: number;
  updated_at: string;
  delivered_at: string;
  soldout_at: string;
  stock_count: number | null;
  is_beginner?: number;
  opened_at?: string;
  fresh_flag?: number | null;
  i18n?: string;
  bottle_size?: string; // 瓶の容量（'1.8L' | '720ml' | '750ml'。90ml提供の杯数目安に使う）
  kan_ok?: number; // 熱燗可（1=OK・1合徳利のみ。0/NULL=不可）
};

export const SAKE_COLUMNS =
  "id, brand, sub_name, brewery, prefecture, grade, price, volume, description, taste_tags, pairings, taste_chart, season_label, is_hidden, (photo IS NOT NULL) AS has_photo, photo_type, label_color, status, sort_order, updated_at, delivered_at, soldout_at, stock_count, is_beginner, opened_at, fresh_flag, i18n, bottle_size, kan_ok";
