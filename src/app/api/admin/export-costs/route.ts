import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { isOwner } from "@/lib/auth";
import { getSettings, cupsFor, rateFor } from "@/lib/pricing";
import { collectCupStats } from "@/lib/cups";

// 原価つきの銘柄一覧を CSV で出す（管理者のみ・読み取り専用）。2026-11-17
// 飲み放題に入れる日本酒の選定用（オーナー指示）。売価・在庫・注文には一切触れない。
// 1 杯原価は 2 通り出す:
//   ・液量だけ … 仕入単価(税抜) ÷ 瓶の容量(ml) × 90ml
//   ・設定の杯数 … 仕入単価(税抜) ÷ 1 本の提供杯数（1.8L=19 杯などロス込みの設定値）
// 実原価率 = 設定の杯数での 1 杯原価 ÷ 売価(税抜)。設定原価率（25% 等）と同じとは限らない（最低売価・100 円切り上げのため）。
export const dynamic = "force-dynamic";

function bottleMl(size: string): number {
  const s = String(size || "");
  if (/1800|1\.?8\s*l/i.test(s)) return 1800;
  if (/720/.test(s) || /四合|4\s*合/.test(s)) return 720;
  if (/750/.test(s)) return 750;
  const m = s.match(/(\d{3,4})\s*ml/i);
  return m ? Number(m[1]) : 1800;
}
const esc = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [settings, stats, rows] = await Promise.all([
    getSettings(),
    collectCupStats(),
    all<{
      id: number; brand: string; sub_name: string; brewery: string; prefecture: string; grade: string; price: number | null;
      cost_excl_tax: number | null; bottle_size: string; kubun: string; status: string; stock_count: number | null;
      is_hidden: number; archived: number; kan_ok: number; season_label: string; delivered_at: string; soldout_at: string; opened_at: string;
    }>(
      `SELECT id, brand, COALESCE(sub_name,'') AS sub_name, COALESCE(brewery,'') AS brewery, COALESCE(prefecture,'') AS prefecture,
              COALESCE(grade,'') AS grade, price, cost_excl_tax, COALESCE(bottle_size,'1.8L') AS bottle_size, COALESCE(kubun,'通常') AS kubun,
              status, stock_count, COALESCE(is_hidden,0) AS is_hidden, COALESCE(archived,0) AS archived, COALESCE(kan_ok,0) AS kan_ok,
              COALESCE(season_label,'') AS season_label, COALESCE(delivered_at,'') AS delivered_at, COALESCE(soldout_at,'') AS soldout_at,
              COALESCE(opened_at,'') AS opened_at
         FROM sakes ORDER BY archived, sort_order, id`
    ),
  ]);
  const head = [
    "id", "銘柄", "副名", "蔵", "県", "特定名称", "区分", "季節", "瓶の容量", "仕入単価(税抜)", "90ml売価(税込)", "売価(税抜)",
    "設定原価率", "設定の提供杯数", "1杯原価(液量90ml)", "1杯原価(設定杯数)", "実原価率", "状態", "残り杯数", "熱燗可", "非表示", "アーカイブ",
    "納品日", "開栓日", "売切日", "杯数_直近7日", "杯数_直近30日", "杯数_累計",
  ];
  const lines = [head.join(",")];
  for (const r of rows) {
    const ml = bottleMl(r.bottle_size);
    const cups = cupsFor(r.bottle_size, settings);
    const cost = r.cost_excl_tax;
    const priceEx = r.price != null ? Math.round(r.price / (1 + settings.taxRate)) : null;
    const perLiquid = cost != null ? Math.round((cost / ml) * 90) : "";
    const perCup = cost != null && cups ? Math.round(cost / cups) : "";
    const realRate = cost != null && cups && priceEx ? `${((cost / cups / priceEx) * 100).toFixed(1)}%` : "";
    const st = stats.get(r.id);
    lines.push([
      r.id, r.brand, r.sub_name, r.brewery, r.prefecture, r.grade, r.kubun, r.season_label, r.bottle_size, cost ?? "", r.price ?? "", priceEx ?? "",
      `${(rateFor(r.kubun, settings) * 100).toFixed(0)}%`, cups, perLiquid, perCup, realRate, r.status, r.stock_count ?? "", r.kan_ok ? 1 : 0,
      r.is_hidden ? 1 : 0, r.archived ? 1 : 0, r.delivered_at, r.opened_at, r.soldout_at, st?.d7 ?? 0, st?.d30 ?? 0, st?.total ?? 0,
    ].map(esc).join(","));
  }
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sake-costs-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
