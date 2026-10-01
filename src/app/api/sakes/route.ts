import { NextRequest, NextResponse } from "next/server";
import { all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake } from "@/lib/types";
import { canOrderGo } from "@/lib/sizes";

// 日本酒の表示データを返す。
//  - ?ids=1,2,3 … 指定IDのみ（MOの注文時の最終確認用）。
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

  const base = allMode
    ? `SELECT ${SAKE_COLUMNS} FROM sakes WHERE archived = 0 AND is_hidden = 0 AND price > 0 ORDER BY sort_order, id LIMIT 300`
    : `SELECT ${SAKE_COLUMNS} FROM sakes WHERE id IN (${ids.map(() => "?").join(",")})`;
  const rows = await all<SakeRow>(base, allMode ? [] : ids);
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
      en: s.en,
    };
  });
  const live = req.nextUrl.searchParams.has("live");
  return NextResponse.json({ sakes }, {
    headers: { "Cache-Control": live ? "public, s-maxage=20, stale-while-revalidate=120" : "public, s-maxage=300, stale-while-revalidate=86400" },
  });
}
