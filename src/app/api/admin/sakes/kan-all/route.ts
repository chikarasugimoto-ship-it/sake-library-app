import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { get, run, audit } from "@/lib/db";
import { isOwner } from "@/lib/auth";

// 熱燗可の一括切替（2026-08-18 オーナー指示「すべての銘柄で熱燗できるようにしてほしい」）。
//  在庫ボードの一括ボタン（owner のみ表示）から実行する。
//  { on: true }  → 現役（archived=0）の全銘柄を kan_ok=1 に（客画面のサイズ選択に「熱燗1合」が出る）
//  { on: false } → 現役の全銘柄を kan_ok=0 に（UIボタンはONのみ。OFFは基本は銘柄ごとの個別トグルで行う）
//  以後の微調整（特定銘柄だけ熱燗不可に戻す等）は在庫ボードの個別「🔥熱燗」トグルで。
export async function POST(req: NextRequest) {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as { on?: boolean };
  if (typeof b.on !== "boolean") return NextResponse.json({ error: "on(boolean)が必要です" }, { status: 400 });

  // 変更対象（現在フラグが逆のもの）だけ数えて件数として返す
  const target = await get<{ n: number }>(
    b.on
      ? "SELECT COUNT(*) AS n FROM sakes WHERE archived = 0 AND (kan_ok IS NULL OR kan_ok = 0)"
      : "SELECT COUNT(*) AS n FROM sakes WHERE archived = 0 AND kan_ok = 1"
  );
  const total = await get<{ n: number }>("SELECT COUNT(*) AS n FROM sakes WHERE archived = 0");

  await run(
    `UPDATE sakes SET kan_ok = ?, updated_at = datetime('now','localtime')
     WHERE archived = 0 AND COALESCE(kan_ok, 0) != ?`,
    [b.on ? 1 : 0, b.on ? 1 : 0]
  );

  await audit("sake.kanAll", { on: b.on, changed: target?.n ?? 0, total: total?.n ?? 0 });
  revalidatePath("/");
  revalidatePath("/zukan");
  return NextResponse.json({ ok: true, on: b.on, changed: target?.n ?? 0, total: total?.n ?? 0 });
}
