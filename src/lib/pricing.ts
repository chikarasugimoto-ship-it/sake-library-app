import { all, run } from "./db";

// 価格設定（スプレッドシートの「設定」と同じ既定値）
export type PriceSettings = {
  rateNormal: number; // 通常 目標原価率
  ratePremium: number; // プレミア・希少 原価率
  rateLimited: number; // 期間限定 原価率
  taxRate: number; // 消費税率
  cups1800: number; // 1.8L 1本の提供杯数
  cups750: number; // 750ml 1本の提供杯数
  minPrice: number; // 最低売価(税込)
  roundUnit: number; // 売価の丸め単位
};

export const DEFAULT_SETTINGS: PriceSettings = {
  rateNormal: 0.25,
  ratePremium: 0.25,
  rateLimited: 0.25,
  taxRate: 0.1,
  cups1800: 19,
  cups750: 8,
  minPrice: 800,
  roundUnit: 100,
};

const KEYS: (keyof PriceSettings)[] = ["rateNormal", "ratePremium", "rateLimited", "taxRate", "cups1800", "cups750", "minPrice", "roundUnit"];

export async function getSettings(): Promise<PriceSettings> {
  const rows = await all<{ key: string; value: string }>("SELECT key, value FROM settings");
  const map = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const s = { ...DEFAULT_SETTINGS };
  for (const k of KEYS) {
    const v = map.get(k);
    if (v != null && !isNaN(v)) (s as Record<string, number>)[k] = v;
  }
  return s;
}

export async function saveSettings(patch: Partial<PriceSettings>): Promise<void> {
  for (const k of KEYS) {
    const v = patch[k];
    if (v != null && !isNaN(Number(v))) {
      await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [k, String(v)]);
    }
  }
}

export type Kubun = "通常" | "プレミア・希少" | "期間限定";

export function cupsFor(bottleSize: string, s: PriceSettings): number {
  const str = String(bottleSize || "");
  if (/1800|1\.?8\s*l/i.test(str)) return s.cups1800; // 1.8L / 1800ml
  if (/720|750|四合|4\s*合/.test(str)) return s.cups750; // 四合瓶(720〜750ml) ≈ 8杯
  // その他(500ml 等)は 1.8L 設定の1杯量(≈95ml)で換算
  const m = str.match(/(\d{3,4})\s*ml/i);
  if (m) {
    const ml = Number(m[1]);
    const perPour = 1800 / (s.cups1800 || 19);
    return Math.max(1, Math.round(ml / perPour));
  }
  return s.cups1800;
}
export function rateFor(kubun: string, s: PriceSettings): number {
  if (kubun === "プレミア・希少") return s.ratePremium;
  if (kubun === "期間限定") return s.rateLimited;
  return s.rateNormal;
}

// 仕入単価(税抜)＋容量＋区分 → 1杯の税込売価（切り上げ・最低売価で下限）
export function computeSellPrice(costExclTax: number, bottleSize: string, kubun: string, s: PriceSettings): number {
  if (!costExclTax || costExclTax <= 0) return 0;
  const cups = cupsFor(bottleSize, s) || 19;
  const rate = rateFor(kubun, s) || 0.25;
  const perCup = costExclTax / cups;
  const exclTax = perCup / rate;
  const inclTax = exclTax * (1 + s.taxRate);
  const unit = s.roundUnit || 100;
  const rounded = Math.ceil(inclTax / unit) * unit;
  return Math.max(rounded, s.minPrice || 0);
}
