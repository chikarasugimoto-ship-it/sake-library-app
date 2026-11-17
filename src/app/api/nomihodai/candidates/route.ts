import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { all } from "@/lib/db";
import { collectCupStats } from "@/lib/cups";

// 飲み放題の「自動の枠」に入れる日本酒の候補を MO（モバイルオーダー）へ返す（2026-11-18・読み取り専用）。
//  - MO が「動きの遅い銘柄」を選ぶための材料: 売価・状態・残り・開栓日・納品日・直近の杯数・仕入単価が入っているか
//  - 仕入単価そのものは返さない（入っているかどうかだけ）
//  - 認証: ?token= が MO_KITCHEN_TOKEN か SAKE_BRIDGE_SECRET（/api/order/consume と同じ鍵）
//  - 売価・在庫・注文には一切触れない
export const dynamic = "force-dynamic";

function tokenOk(token: string): boolean {
  const accepted = [process.env.MO_KITCHEN_TOKEN, process.env.SAKE_BRIDGE_SECRET].filter((v): v is string => !!v);
  if (!token || accepted.length === 0) return false;
  const t = Buffer.from(token);
  return accepted.some((a) => {
    const b = Buffer.from(a);
    return b.length === t.length && timingSafeEqual(b, t);
  });
}

export async function GET(req: NextRequest) {
  if (!tokenOk(req.nextUrl.searchParams.get("token") || "")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [stats, rows] = await Promise.all([
    collectCupStats(),
    all<{
      id: number; brand: string; sub_name: string; grade: string; price: number | null; cost_excl_tax: number | null; bottle_size: string;
      status: string; stock_count: number | null; season_label: string; delivered_at: string; opened_at: string;
    }>(
      `SELECT id, brand, COALESCE(sub_name,'') AS sub_name, COALESCE(grade,'') AS grade, price, cost_excl_tax, COALESCE(bottle_size,'1.8L') AS bottle_size,
              status, stock_count, COALESCE(season_label,'') AS season_label, COALESCE(delivered_at,'') AS delivered_at, COALESCE(opened_at,'') AS opened_at
         FROM sakes WHERE COALESCE(archived,0) = 0 AND COALESCE(is_hidden,0) = 0 ORDER BY sort_order, id`
    ),
  ]);
  return NextResponse.json({
    ok: true,
    sakes: rows.map((r) => {
      const st = stats.get(r.id);
      const text = `${r.brand} ${r.sub_name}`;
      return {
        id: r.id,
        name: [r.brand, r.sub_name].filter(Boolean).join(" "),
        price: r.price ?? 0,
        status: r.status,
        stockCount: r.stock_count,
        hasCost: r.cost_excl_tax != null && r.cost_excl_tax > 0,
        bottleSize: r.bottle_size,
        openedAt: r.opened_at,
        deliveredAt: r.delivered_at,
        cups7: st?.d7 ?? 0,
        cups30: st?.d30 ?? 0,
        // 季節商品の目印（季節欄か、名前の表記）と、発泡・にごり（飲み放題に向かない）
        seasonal: !!r.season_label || /ひやおろし|秋あがり|秋上がり|あきふかし|冷卸|しぼりたて|新酒|夏酒|夏吟|春酒|うすにごり/.test(text),
        sparkling: /発泡|スパークリング|sparkling|にごり|活性/i.test(text),
      };
    }),
  });
}
