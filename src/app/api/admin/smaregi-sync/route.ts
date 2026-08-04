import { NextRequest, NextResponse } from "next/server";
import { all, run, audit, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { toSake } from "@/lib/types";
import { createSakeProduct, updateSakeProduct, smaregiConfigured } from "@/lib/smaregi";

type Row = SakeRow & { smaregi_product_id: string };

// 日本酒をスマレジPOS商品へ全件同期。
// mode="missing"（既定）: 未作成のものだけ作成 / mode="all": 既存は商品名・価格を更新も
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!smaregiConfigured()) return NextResponse.json({ error: "smaregi_unconfigured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { mode?: "missing" | "all" };
  const mode = body.mode === "all" ? "all" : "missing";

  const rows = await all<Row>(
    `SELECT ${SAKE_COLUMNS}, smaregi_product_id FROM sakes WHERE archived = 0 ORDER BY sort_order, id`
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const failed: { id: number; brand: string; error: string }[] = [];

  for (const row of rows) {
    const sake = toSake(row);
    const pid = (row.smaregi_product_id || "").trim();
    try {
      if (!pid) {
        const productId = await createSakeProduct(sake);
        await run("UPDATE sakes SET smaregi_product_id = ? WHERE id = ?", [productId, sake.id]);
        created++;
      } else if (mode === "all") {
        await updateSakeProduct(pid, sake);
        updated++;
      } else {
        skipped++;
      }
    } catch (e) {
      failed.push({ id: sake.id, brand: sake.brand, error: e instanceof Error ? e.message.slice(0, 160) : "error" });
    }
  }

  await audit("smaregi.sync", { mode, created, updated, skipped, failed: failed.length });
  return NextResponse.json({ ok: true, mode, total: rows.length, created, updated, skipped, failed });
}
