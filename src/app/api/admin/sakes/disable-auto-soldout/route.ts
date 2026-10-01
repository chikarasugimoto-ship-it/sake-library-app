import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { get, run, audit } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

// 自動売切の全解除（2026-07-24 オーナー指示・在庫ボードの一括ボタンから実行）。
//  背景: 残数を管理している銘柄が注文の積み重ねで残数0→営業中に無言で売切化し、
//        くどき上手・黒龍・神亀・上喜元など多数が「勝手に売り切れ」に見える状態になった。
//  やること:
//   ① 全銘柄の残数(stock_count)を NULL=管理しない に戻す（自動減算・目安表示の対象から外す）
//   ② 現在「売切」の銘柄（アーカイブ除く）を一括で「提供中」に戻す
//  以後の売切/提供中は在庫ボードの手動切替のみ。本当に切れている銘柄は実行後に手動で売切へ。
export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const managed = await get<{ n: number }>("SELECT COUNT(*) AS n FROM sakes WHERE stock_count IS NOT NULL");
  const sold = await get<{ n: number }>("SELECT COUNT(*) AS n FROM sakes WHERE status = 'soldout' AND archived = 0");

  await run("UPDATE sakes SET stock_count = NULL, updated_at = datetime('now','localtime') WHERE stock_count IS NOT NULL");
  await run(
    "UPDATE sakes SET status = 'available', soldout_at = '', updated_at = datetime('now','localtime') WHERE status = 'soldout' AND archived = 0"
  );

  await audit("sake.disableAutoSoldout", { cleared: managed?.n ?? 0, restored: sold?.n ?? 0 });
  revalidatePath("/");
  return NextResponse.json({ ok: true, cleared: managed?.n ?? 0, restored: sold?.n ?? 0 });
}
