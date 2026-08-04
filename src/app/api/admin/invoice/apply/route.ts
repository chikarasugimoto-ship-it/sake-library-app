import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { get, run, audit, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { toSake } from "@/lib/types";
import { createSakeProduct, smaregiConfigured } from "@/lib/smaregi";

type ApplyItem = {
  brand: string;
  bottle_size: string;
  cost_excl_tax: number | null;
  kubun: string;
  price: number;
  sakeId: number | null;
};

// 納品書スキャンの確認内容を反映：既存は価格更新、新規は登録（売価は自動算出済み）
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { items } = (await req.json()) as { items?: ApplyItem[] };
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ error: "対象がありません" }, { status: 400 });

  let created = 0;
  let updated = 0;
  for (const it of items) {
    const brand = (it.brand ?? "").trim().slice(0, 60);
    if (!brand || !it.price || it.price <= 0) continue;
    const size = /750/.test(it.bottle_size) ? "750ml" : "1.8L";
    const kubun = ["プレミア・希少", "期間限定"].includes(it.kubun) ? it.kubun : "通常";

    if (it.sakeId) {
      // 再納品＝新しい在庫が届いた：納品日を更新し、売切記録をリセットして提供中に戻す
      // （納品→売切の消化サイクルをこの納品から数え直す）
      await run(
        "UPDATE sakes SET price = ?, cost_excl_tax = ?, bottle_size = ?, kubun = ?, delivered_at = datetime('now','localtime'), soldout_at = '', status = 'available', updated_at = datetime('now','localtime') WHERE id = ?",
        [it.price, it.cost_excl_tax ?? null, size, kubun, it.sakeId]
      );
      updated++;
    } else {
      const { lastInsertRowid } = await run(
        `INSERT INTO sakes (store_id, brand, price, cost_excl_tax, bottle_size, kubun, delivered_at, sort_order)
         VALUES (1, ?, ?, ?, ?, ?, datetime('now','localtime'), (SELECT COALESCE(MAX(sort_order),0)+1 FROM sakes))`,
        [brand, it.price, it.cost_excl_tax ?? null, size, kubun]
      );
      created++;
      // スマレジ商品も作成（注文連携用）。失敗しても登録は維持
      if (smaregiConfigured() && lastInsertRowid) {
        try {
          const row = await get<SakeRow>(`SELECT ${SAKE_COLUMNS} FROM sakes WHERE id = ?`, [lastInsertRowid]);
          if (row) {
            const pid = await createSakeProduct(toSake(row));
            await run("UPDATE sakes SET smaregi_product_id = ? WHERE id = ?", [pid, lastInsertRowid]);
          }
        } catch {}
      }
    }
  }
  await audit("invoice.apply", { created, updated });
  revalidatePath("/");
  revalidatePath("/zukan");
  return NextResponse.json({ ok: true, created, updated });
}
