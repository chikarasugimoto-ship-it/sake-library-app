import { redirect } from "next/navigation";
import { isAdmin, isOwner } from "@/lib/auth";
import { all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake } from "@/lib/types";
import { collectCupStats } from "@/lib/cups";
import { StockBoard } from "./StockBoard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const owner = await isOwner();
  // 在庫ボードは「現役」だけ。前日以前に売切れた銘柄は翌日に自動で外す（→「在庫から外した日本酒」へ）。
  // 当日売切れは残す（同日中の取り消し用）。
  // 2つの独立クエリを並行実行
  const [rows, cupStats] = await Promise.all([
    all<SakeRow>(
      `SELECT ${SAKE_COLUMNS} FROM sakes
       WHERE archived = 0
         AND NOT (status = 'soldout' AND soldout_at != '' AND date(soldout_at) < date('now','localtime'))
       ORDER BY sort_order, id`
    ),
    // 杯数カウント（注文実績から集計）。カードに「30日◯杯・累計◯杯」を出して発注判断に使う
    collectCupStats(),
  ]);
  const cups: Record<number, { total: number; d30: number }> = {};
  for (const [id, c] of cupStats) cups[id] = { total: c.total, d30: c.d30 };
  return <StockBoard initialSakes={rows.map(toSake)} owner={owner} cups={cups} />;
}
