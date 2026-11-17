// 売価の見直し（2026-11-18 オーナー指示「いま販売している日本酒すべての値段変更・原価率 25〜30% 以下に」）。
// 提案売価 = 原価率が上限（既定 30%）以下になる、丸め単位でいちばん安い税込売価。最低売価で下限。
//   原価率 = 1 杯原価（仕入単価(税抜) ÷ 1 本の提供杯数）÷ 売価(税抜)
//   売っているのは 90ml（=price）と 1 合（=price×2・180ml）だけなので、どちらも同じ原価率になる。
// 純関数だけ（DB を触らない）。API は /api/admin/reprice。
import { computeSellPrice, cupsFor, type PriceSettings } from "./pricing";

export type RepriceInput = {
  id: number; brand: string; kubun: string; bottle_size: string; status: string;
  price: number | null; cost_excl_tax: number | null; smaregi_product_id: string;
};
export type RepriceRow = {
  id: number; brand: string; kubun: string; bottleSize: string; status: string;
  cost: number | null; cups: number; perCup: number | null;
  price: number | null; rate: number | null;         // 今の売価(税込)と原価率
  proposed: number | null; proposedRate: number | null; // 提案売価(税込)と原価率
  linked: boolean; // スマレジ商品に紐づいているか
};

export function rateOf(cost: number | null, cups: number, priceIncl: number | null, taxRate: number): number | null {
  if (!cost || !cups || !priceIncl) return null;
  return cost / cups / (priceIncl / (1 + taxRate));
}

export function buildRepriceRows(sakes: RepriceInput[], base: PriceSettings, opts: { maxRate: number; minPrice: number; roundUnit: number }): RepriceRow[] {
  // 区分に関係なく同じ上限で計算する（上限は 1 つ・オーナー指示）
  const s: PriceSettings = { ...base, rateNormal: opts.maxRate, ratePremium: opts.maxRate, rateLimited: opts.maxRate, minPrice: opts.minPrice, roundUnit: opts.roundUnit };
  return sakes.map((r) => {
    const cups = cupsFor(r.bottle_size, s);
    const cost = r.cost_excl_tax && r.cost_excl_tax > 0 ? r.cost_excl_tax : null;
    const proposed = cost ? computeSellPrice(cost, r.bottle_size, r.kubun, s) : null;
    return {
      id: r.id, brand: r.brand, kubun: r.kubun, bottleSize: r.bottle_size, status: r.status,
      cost, cups, perCup: cost ? Math.round(cost / cups) : null,
      price: r.price, rate: rateOf(cost, cups, r.price, s.taxRate),
      proposed, proposedRate: rateOf(cost, cups, proposed, s.taxRate),
      linked: !!(r.smaregi_product_id || "").trim(),
    };
  });
}
