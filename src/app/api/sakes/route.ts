import { NextRequest, NextResponse } from "next/server";
import { all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake } from "@/lib/types";
import { canOrderGo } from "@/lib/sizes";

// 日本酒の表示データを返す。
//  - ?ids=1,2,3 … 指定IDのみ（削除済み/写真なしも含む＝図鑑バックフィル用・従来）。
//  - ?all=1     … 現在「注文できる」銘柄の全件（archived=0・非表示除外・価格>0）。MOの日本酒棚がライブ取得する用途。
//                 これでMO側の銘柄追加/削除が“同期不要”で即反映される（旧: 手動スナップショット取込）。
//  - ?live=1    … 短キャッシュ（営業中の売切/価格変更を数十秒で反映）。
export async function GET(req: NextRequest) {
  const allMode = req.nextUrl.searchParams.get("all") === "1";
  const ids = (req.nextUrl.searchParams.get("ids") || "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 300);
  if (!allMode && !ids.length) return NextResponse.json({ sakes: [] });

  // 酒神レア度も付ける（updated_at が sakes/gods で曖昧になるためサブクエリで回避）
  const base = allMode
    ? `SELECT ${SAKE_COLUMNS} FROM sakes WHERE archived = 0 AND is_hidden = 0 AND price > 0 ORDER BY sort_order, id LIMIT 300`
    : `SELECT ${SAKE_COLUMNS} FROM sakes WHERE id IN (${ids.map(() => "?").join(",")})`;
  const rows = await all<SakeRow & { god_rarity: string | null; god_name: string | null; god_has_art: number | null; god_updated: string | null }>(
    `SELECT base.*, g.rarity AS god_rarity, g.name AS god_name,
            (g.god_art IS NOT NULL OR g.god_art_url <> '') AS god_has_art, g.updated_at AS god_updated
       FROM (${base}) base
       LEFT JOIN gods g ON g.sake_id = base.id`,
    allMode ? [] : ids
  );
  const sakes = rows.map((row) => {
    const s = toSake(row);
    return {
      id: s.id,
      brand: s.brand,
      subName: s.subName, // MOの日本酒棚が「銘柄＋サブ名」を出すため
      brewery: s.brewery,
      prefecture: s.prefecture,
      labelColor: s.labelColor,
      hasPhoto: s.hasPhoto,
      isPremium: s.isPremium,
      grade: s.grade,
      price: s.price,
      volume: s.volume,
      kanOk: s.kanOk, // 熱燗可（MOのサイズ選択がライブ取得で参照。欠落時はMO側でfalse扱い）
      // 残数（90mlグラス換算・null=管理していない）と「1合・熱燗を出せるか」（残り2杯以上）。
      // 2026-09-30: MOが注文時に「残りを超える杯数」を断り、注文後に /api/order/consume で減らすために公開。
      stockCount: s.stockCount,
      goOk: canOrderGo(s.stockCount),
      status: s.status,
      updatedAt: s.updatedAt,
      rarity: row.god_rarity || "",
      godName: row.god_name || "",
      hasArt: !!row.god_has_art,
      godUpdated: row.god_updated || "",
      en: s.en,
    };
  });
  const live = req.nextUrl.searchParams.has("live");
  return NextResponse.json({ sakes }, {
    headers: { "Cache-Control": live ? "public, s-maxage=20, stale-while-revalidate=120" : "public, s-maxage=300, stale-while-revalidate=86400" },
  });
}
