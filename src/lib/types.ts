import type { SakeRow } from "./db";

export type Sake = {
  id: number;
  brand: string;
  subName: string;
  brewery: string;
  prefecture: string;
  grade: string;
  price: number | null;
  volume: string;
  description: string;
  tasteTags: string[];
  pairings: string[];
  tasteChart: { sweet: number; acid: number; aroma: number; sharp: number };
  seasonLabel: string;
  isHidden: boolean;
  isPremium: boolean;
  hasPhoto: boolean;
  labelColor: string;
  status: "available" | "low" | "soldout";
  sortOrder: number;
  deliveredAt: string; // 納品日時（'YYYY-MM-DD HH:MM:SS' / 不明は空）
  soldoutAt: string; // 売切日時（同・在庫ありは空）
  updatedAt: string; // 更新日時（画像キャッシュのバージョンに使う）
  stockCount: number | null; // 残数（手動・NULLは未設定）
  isBeginner: boolean; // 店が指定する初心者おすすめ（「今日の3本」キュレーション）
  freshSensitive: boolean; // 生酒など早めに飲みたい酒か（手動上書きがあれば優先・無ければラベルから自動判定）
  freshFlag: number | null; // 鮮度枠の手動上書き（null=自動 / 1=必ず出す / 0=出さない）。編集画面の初期値に使う
  openedAt: string; // 開栓日時（最初の注文で記録・売切/補充でリセット。空＝未開栓/不明）
  en: SakeEn | null; // 英訳（AI生成・未生成は null。表示は en があれば英語、無ければ日本語）
};

// 日本酒情報の英訳（インバウンド対応）
export type SakeEn = {
  brand: string;
  subName: string;
  brewery: string;
  prefecture: string;
  grade: string;
  description: string;
  tasteTags: string[];
  pairings: string[];
};

// 画像URL。updated_at をバージョン(?v=)に付けることで、ブラウザ/CDNに長期キャッシュさせつつ
// 写真を撮り直すと URL が変わって即差し替わる（読み込みは速く・更新は即反映）。
export function photoUrl(id: number, updatedAt?: string): string {
  const v = (updatedAt || "").replace(/\D/g, "").slice(0, 14) || "0";
  return `/api/photo/${id}?v=${v}`;
}

// 'YYYY-MM-DD HH:MM:SS'（ローカル時刻）を、その日のローカル0時のms値に。空・不正は null
// ＝消化日数は「暦日」で数える（当日完売=0, 翌日=1）。時刻の端数で1日ずれないようにする
function localDayStart(ts?: string): number | null {
  if (!ts) return null;
  const d = new Date(ts.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 納品→売切までの日数（消化日数・暦日）。両方そろわなければ null
export function digestDays(deliveredAt?: string, soldoutAt?: string): number | null {
  const d = localDayStart(deliveredAt);
  const s = localDayStart(soldoutAt);
  if (d == null || s == null || s < d) return null;
  return Math.max(0, Math.round((s - d) / 86_400_000));
}

// 納品からの経過日数（在庫中の銘柄向け・暦日）。基準時刻は呼び出し側で渡す
export function daysSinceDelivery(deliveredAt: string | undefined, now: number): number | null {
  const d = localDayStart(deliveredAt);
  if (d == null) return null;
  const n = new Date(now);
  n.setHours(0, 0, 0, 0);
  if (n.getTime() < d) return null;
  return Math.max(0, Math.round((n.getTime() - d) / 86_400_000));
}

// プレミアム判定は価格で自動（運用ゼロ）。閾値は env で変更可
export function premiumThreshold(): number {
  return Number(process.env.PREMIUM_PRICE_THRESHOLD || 2000);
}

// 開栓後に味が落ちやすく「早めに飲みたい」酒か、ラベル情報の語から自動判定（運用ゼロ）。
// 生酒（火入れしない）・にごり・おりがらみ・活性・発泡など、酸化や発酵で風味が変わりやすいもの。
// ※「生酛(きもと)」「山廃」は造りの名前で鮮度とは無関係なので、ここでは拾わない（パターンに含めない）。
const FRESH_RE =
  /(生酒|生詰|生貯|生原酒|本生|無濾過生|しぼりたて|搾りたて|しぼり立て|おりがらみ|滓がらみ|にごり|うすにごり|活性|スパークリング|微発泡|発泡|どぶろく)/;
export function isFreshSensitive(s: {
  grade?: string;
  subName?: string;
  brand?: string;
  tasteTags?: string[];
}): boolean {
  // 構造化されたラベル項目だけを見る（紹介文はノイズが多いので対象外）
  const hay = [s.grade, s.subName, s.brand, (s.tasteTags || []).join(" ")].filter(Boolean).join(" ");
  return FRESH_RE.test(hay);
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function parseEn(text?: string): SakeEn | null {
  if (!text) return null;
  const o = parseJson<{ en?: Partial<SakeEn> }>(text, {});
  const e = o.en;
  if (!e || typeof e !== "object") return null;
  // 最低限 description か brand があれば英訳済みとみなす
  if (!e.description && !e.brand) return null;
  return {
    brand: String(e.brand ?? ""),
    subName: String(e.subName ?? ""),
    brewery: String(e.brewery ?? ""),
    prefecture: String(e.prefecture ?? ""),
    grade: String(e.grade ?? ""),
    description: String(e.description ?? ""),
    tasteTags: Array.isArray(e.tasteTags) ? e.tasteTags.map(String) : [],
    pairings: Array.isArray(e.pairings) ? e.pairings.map(String) : [],
  };
}

export function toSake(row: SakeRow): Sake {
  const chart = parseJson(row.taste_chart, { sweet: 0, acid: 0, aroma: 0, sharp: 0 });
  const tasteTags = parseJson<string[]>(row.taste_tags, []);
  return {
    id: row.id,
    brand: row.brand,
    subName: row.sub_name,
    brewery: row.brewery,
    prefecture: row.prefecture,
    grade: row.grade,
    price: row.price,
    volume: row.volume,
    description: row.description,
    tasteTags,
    pairings: parseJson(row.pairings, []),
    tasteChart: {
      sweet: Number(chart.sweet) || 0,
      acid: Number(chart.acid) || 0,
      aroma: Number(chart.aroma) || 0,
      sharp: Number(chart.sharp) || 0,
    },
    seasonLabel: row.season_label,
    isHidden: !!row.is_hidden,
    isPremium: row.price != null && row.price >= premiumThreshold(),
    hasPhoto: !!row.has_photo,
    labelColor: row.label_color || "#1e3d2f",
    status: (["available", "low", "soldout"].includes(row.status) ? row.status : "available") as Sake["status"],
    sortOrder: row.sort_order,
    deliveredAt: row.delivered_at || "",
    soldoutAt: row.soldout_at || "",
    updatedAt: row.updated_at || "",
    stockCount: row.stock_count != null ? Number(row.stock_count) : null,
    isBeginner: !!row.is_beginner,
    freshSensitive:
      row.fresh_flag != null
        ? !!row.fresh_flag // 手動上書きを優先（店が「必ず出す/出さない」を指定）
        : isFreshSensitive({ grade: row.grade, subName: row.sub_name, brand: row.brand, tasteTags }),
    freshFlag: row.fresh_flag != null ? Number(row.fresh_flag) : null,
    openedAt: row.opened_at || "",
    en: parseEn(row.i18n),
  };
}

// 言語に応じて値を選ぶ小ヘルパ（en が空なら ja にフォールバック）
export function pickText(ja: string, en: string | undefined, lang: "ja" | "en"): string {
  return lang === "en" && en ? en : ja;
}
