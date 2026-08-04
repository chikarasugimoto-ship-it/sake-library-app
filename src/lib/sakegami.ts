// 酒神（さけがみ）図鑑のドメインロジック（純粋関数・サーバー/クライアント両用）。
// レア度・地方は「価格/特定名称/季節/隠し酒/産地」という動かせない事実から機械的に決まる
// ＝ガチャ抽選ではない（賭博性ゼロ）。AIは使わない（運用ゼロ・店が恣意的にレア度を煽らない根拠）。

export const RARITIES = ["N", "R", "SR", "SSR", "UR", "LR"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_META: Record<Rarity, { jp: string; en: string; color: string; bg: string; ring: string }> = {
  N: { jp: "常", en: "NORMAL", color: "#7d837b", bg: "#eef0ec", ring: "#d4d8d2" },
  R: { jp: "蔵", en: "RARE", color: "#4f7a5c", bg: "#e8f1ea", ring: "#bcd9c5" },
  SR: { jp: "匠", en: "RARE+", color: "#a8702f", bg: "#f6ecdd", ring: "#e3c79e" },
  SSR: { jp: "雅", en: "SUPER", color: "#b8923a", bg: "#f8f0d8", ring: "#e6cf86" },
  UR: { jp: "極", en: "ULTRA", color: "#9a7b1f", bg: "#f6ead0", ring: "#dcc06a" },
  LR: { jp: "伝説", en: "LEGEND", color: "#8a6a1a", bg: "#f3e3b0", ring: "#d8b85a" },
};

export function rarityRank(r: Rarity): number {
  return Math.max(0, RARITIES.indexOf(r));
}

// 入手困難・希少銘柄（自動で UR に格上げ）。店長は別途 is_legend で LR 指定も可。
const DIFFICULT_BRANDS = [
  "十四代", "而今", "新政", "花陽浴", "飛露喜", "田酒", "黒龍", "磯自慢", "鍋島",
  "醸し人九平次", "ロ万", "赤武", "風の森", "作", "No.6", "産土", "新政No.6",
];

// 集めた酒の {価格・特定名称・季節・隠し酒・銘柄} からレア度を機械決定。
export function rarityFor(s: {
  price?: number | null;
  grade?: string;
  seasonLabel?: string;
  isHidden?: boolean;
  brand?: string;
  isLegend?: boolean;
}): Rarity {
  if (s.isLegend) return "LR"; // 店長が手動指定した伝説（十四代など）
  if (s.isHidden) return "LR"; // 隠し酒
  const g = s.grade || "";
  const p = s.price ?? 0;
  const brand = s.brand || "";
  const brandHit = DIFFICULT_BRANDS.some((b) => brand.includes(b));
  if (brandHit || p >= 3000) return "UR";
  if (p >= 2000 || /大吟醸/.test(g)) return "SSR";
  if (/吟醸/.test(g) || s.seasonLabel) return "SR";
  if (/純米|本醸造|特別/.test(g) || p >= 1200) return "R";
  return "N";
}

// ===== 都道府県 → 8地方（＋沖縄） =====
export const REGION8 = ["北海道・東北", "関東", "中部", "近畿", "中国", "四国", "九州", "沖縄"] as const;
export type Region8 = (typeof REGION8)[number];

const PREF_TO_REGION: Record<string, Region8> = {};
(
  [
    [["北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島"], "北海道・東北"],
    [["茨城", "栃木", "群馬", "埼玉", "千葉", "東京", "神奈川"], "関東"],
    [["新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知"], "中部"],
    [["三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山"], "近畿"],
    [["鳥取", "島根", "岡山", "広島", "山口"], "中国"],
    [["徳島", "香川", "愛媛", "高知"], "四国"],
    [["福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島"], "九州"],
    [["沖縄"], "沖縄"],
  ] as [string[], Region8][]
).forEach(([prefs, region]) => prefs.forEach((p) => (PREF_TO_REGION[p] = region)));

// 「山形県」「東京都」等のサフィックスを落として照合。不明は ""（地方未判定）。
export function region8For(prefecture?: string): Region8 | "" {
  const raw = String(prefecture || "").trim();
  if (!raw) return "";
  const key = raw.replace(/[都道府県]$/, "");
  return PREF_TO_REGION[key] || PREF_TO_REGION[raw] || "";
}

// 蔵元名の表記ゆれ吸収キー（「新政酒造」「新政」を同一蔵に集約）。
export function breweryKey(brewery?: string): string {
  return String(brewery || "")
    .trim()
    .replace(/(酒造株式会社|株式会社|酒造場|酒造店|酒造|本店|合資会社|有限会社)/g, "")
    .replace(/\s+/g, "");
}
