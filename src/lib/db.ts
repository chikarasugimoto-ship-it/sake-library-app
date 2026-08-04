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
  // LINEログイン会員と、その個人図鑑（端末をまたいで残る）
  `CREATE TABLE IF NOT EXISTS members (
    line_user_id TEXT PRIMARY KEY,
    display_name TEXT DEFAULT '',
    picture_url TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    last_login TEXT DEFAULT (datetime('now','localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS member_tasted (
    line_user_id TEXT NOT NULL,
    sake_id INTEGER NOT NULL,
    tasted_date TEXT DEFAULT '',
    count INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (line_user_id, sake_id)
  )`,
  `CREATE TABLE IF NOT EXISTS member_fav (
    line_user_id TEXT NOT NULL,
    sake_id INTEGER NOT NULL,
    PRIMARY KEY (line_user_id, sake_id)
  )`,
  // 匿名（LINE未登録）でもランキングに参加できるゲスト。端末ごとの guest_id で集計。
  `CREATE TABLE IF NOT EXISTS guests (
    guest_id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    kinds INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  // 匿名（LINE未登録）の図鑑をサーバーにも保存（端末のlocalStorageが消えても残る）。
  // ゲストCookie sksl_guest をキーにする。member_tasted と同じ構造。
  `CREATE TABLE IF NOT EXISTS guest_tasted (
    guest_id TEXT NOT NULL,
    sake_id INTEGER NOT NULL,
    tasted_date TEXT DEFAULT '',
    count INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (guest_id, sake_id)
  )`,
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
  // ===== 酒神図鑑 ＆ 売上グロースの土台（2026-06-22 追加・既存は不変）=====
  // 酒神マスタ（銘柄1:1）。レア度はprice/grade/season/隠し酒から機械導出。画像は持たず
  // レア度別フレーム＋既存ラベル写真＋口上テキスト(kuchijo)で表現する。owner系は member/guest 両対応。
  `CREATE TABLE IF NOT EXISTS gods (
    sake_id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL DEFAULT 1,
    name TEXT DEFAULT '',
    rarity TEXT DEFAULT 'N',
    kuchijo TEXT DEFAULT '',
    region8 TEXT DEFAULT '',
    brewery_key TEXT DEFAULT '',
    is_legend INTEGER DEFAULT 0,
    god_art BLOB,
    god_art_type TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  // 誰がどの酒神を獲得したか（注文=確定獲得。獲得時レア度とイベントスタンプを保存）
  `CREATE TABLE IF NOT EXISTS god_owned (
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    sake_id INTEGER NOT NULL,
    rarity_at TEXT DEFAULT '',
    event_tag TEXT DEFAULT '',
    got_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (owner_kind, owner_id, sake_id)
  )`,
  // 期間イベント（花見/正月/七夕/周年）。期間中は対象レア度を rarity_boost 段だけ昇格
  `CREATE TABLE IF NOT EXISTS sake_events (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    kind TEXT DEFAULT '',
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    rarity_boost INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  // 称号の付与履歴（サーバー権威・いつ酒神王になったか等）
  `CREATE TABLE IF NOT EXISTS titles (
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    granted_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (owner_kind, owner_id, title)
  )`,
  // 隠し酒プレゼントの引換（景表法=総付景品の実体）。reason でユニーク化＝二重発行しない
  `CREATE TABLE IF NOT EXISTS reward_grants (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL DEFAULT 1,
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    code TEXT NOT NULL,
    cap_yen INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'issued',
    issued_at TEXT DEFAULT (datetime('now','localtime')),
    redeemed_at TEXT DEFAULT '',
    redeemed_by TEXT DEFAULT '',
    UNIQUE(owner_kind, owner_id, reason)
  )`,
  // 来店streak算出用（注文成功日でUPSERT）
  `CREATE TABLE IF NOT EXISTS visits (
    owner_kind TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    visit_date TEXT NOT NULL,
    table_use_id TEXT DEFAULT '',
    PRIMARY KEY (owner_kind, owner_id, visit_date)
  )`,
  // SNSシェア発火の計測
  `CREATE TABLE IF NOT EXISTS share_log (
    id INTEGER PRIMARY KEY,
    store_id INTEGER NOT NULL DEFAULT 1,
    owner_kind TEXT DEFAULT '',
    owner_id TEXT DEFAULT '',
    kind TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`,
  // ランキングの事前集計キャッシュ（1行）。全件GROUP BYを毎回せず、60秒ごとに作り直した結果を読む。
  `CREATE TABLE IF NOT EXISTS ranking_cache (
    id INTEGER PRIMARY KEY,
    payload TEXT NOT NULL DEFAULT '',
    computed_at INTEGER NOT NULL DEFAULT 0
  )`,
];

// 後付けカラム（既存DBにも安全に追加。失敗＝既に存在は無視）
const MIGRATIONS = [
  "ALTER TABLE sakes ADD COLUMN smaregi_product_id TEXT DEFAULT ''",
  "ALTER TABLE member_tasted ADD COLUMN count INTEGER DEFAULT 1",
  "ALTER TABLE members ADD COLUMN show_on_ranking INTEGER DEFAULT 0",
  "ALTER TABLE members ADD COLUMN public_slug TEXT DEFAULT ''",
  // ランキング表示名の上書き（変更したらこちらを優先・LINE再ログインで戻らない）
  "ALTER TABLE members ADD COLUMN nickname TEXT DEFAULT ''",
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
  // 酒神のキャラ絵（OpenAI生成・既存godsへ後付け）
  "ALTER TABLE gods ADD COLUMN god_art BLOB",
  "ALTER TABLE gods ADD COLUMN god_art_type TEXT DEFAULT ''",
  // 画像のCDN(Blob)URL。設定済みなら /api/photo・/api/god-art はここへリダイレクト＝DBのBLOB読み出しを回避。
  "ALTER TABLE sakes ADD COLUMN photo_url TEXT DEFAULT ''",
  "ALTER TABLE gods ADD COLUMN god_art_url TEXT DEFAULT ''",
  // 英訳（インバウンド対応）。i18n は {\"en\":{brand,subName,brewery,prefecture,grade,description,tasteTags,pairings}} のJSON。
  "ALTER TABLE sakes ADD COLUMN i18n TEXT DEFAULT ''",
  "ALTER TABLE gods ADD COLUMN kuchijo_en TEXT DEFAULT ''",
  // アイコン（プロフィール画像）＝集めた酒神の sake_id。0=未選択（位アイコンの絵文字を表示）。
  "ALTER TABLE members ADD COLUMN avatar_sake_id INTEGER DEFAULT 0",
  "ALTER TABLE guests ADD COLUMN avatar_sake_id INTEGER DEFAULT 0",
  // 隠し酒プレゼントで「お客様が選んで図鑑に迎えた隠し酒」のsake_id（0=まだ選んでいない＝迎える前）。
  // 物理提供の消し込み(status)とは別軸＝この列で「酒神を図鑑にGET済みか」を管理する。
  "ALTER TABLE reward_grants ADD COLUMN sake_id INTEGER DEFAULT 0",
  // ===== 索引（2026-06-22・PK以外ゼロだった全件スキャンを緩和。列追加ALTERの後に張る）=====
  "CREATE INDEX IF NOT EXISTS idx_sakes_store_archived ON sakes(store_id, archived, sort_order)",
  "CREATE INDEX IF NOT EXISTS idx_sakes_smaregi ON sakes(smaregi_product_id)",
  "CREATE INDEX IF NOT EXISTS idx_member_tasted_created ON member_tasted(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_guest_tasted_created ON guest_tasted(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_god_owned_owner ON god_owned(owner_kind, owner_id)",
  "CREATE INDEX IF NOT EXISTS idx_reward_owner ON reward_grants(owner_kind, owner_id)",
  "CREATE INDEX IF NOT EXISTS idx_visits_owner ON visits(owner_kind, owner_id)",
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

export async function run(sql: string, args: InArgs = []): Promise<{ lastInsertRowid: number | null }> {
  await ready();
  const res = await getClient().execute({ sql, args });
  return { lastInsertRowid: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : null };
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
};

export const SAKE_COLUMNS =
  "id, brand, sub_name, brewery, prefecture, grade, price, volume, description, taste_tags, pairings, taste_chart, season_label, is_hidden, (photo IS NOT NULL) AS has_photo, photo_type, label_color, status, sort_order, updated_at, delivered_at, soldout_at, stock_count, is_beginner, opened_at, fresh_flag, i18n";
