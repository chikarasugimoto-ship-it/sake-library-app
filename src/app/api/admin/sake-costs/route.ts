import { NextRequest, NextResponse } from "next/server";
import { all, get, run, audit } from "@/lib/db";
import { isOwner } from "@/lib/auth";

// 仕入単価（税抜）の入力・修正（管理者のみ・2026-11-19）。
// 納品書スキャンや一括取込を通さずに登録した銘柄は仕入単価が空のままで、原価率が出せず、
// 飲み放題の自動の枠にも入らない。ここで後から入れられるようにする。
//  GET  … アーカイブ以外の銘柄と、今の仕入単価
//  POST { items: [{ id, cost }] } … 仕入単価だけを書き換える。売価・在庫・スマレジには一切触れない
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await all<{ id: number; brand: string; sub_name: string; price: number | null; cost_excl_tax: number | null; status: string; bottle_size: string }>(
    `SELECT id, brand, COALESCE(sub_name,'') AS sub_name, price, cost_excl_tax, status, COALESCE(bottle_size,'1.8L') AS bottle_size
       FROM sakes WHERE archived = 0 ORDER BY (cost_excl_tax IS NULL OR cost_excl_tax <= 0) DESC, sort_order, id`
  );
  return NextResponse.json({
    ok: true,
    rows: rows.map((r) => ({
      id: r.id, name: [r.brand, r.sub_name].filter(Boolean).join(" "), price: r.price, status: r.status, bottleSize: r.bottle_size,
      cost: r.cost_excl_tax != null && r.cost_excl_tax > 0 ? r.cost_excl_tax : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { items?: Array<{ id?: unknown; cost?: unknown }> };
  const items = (Array.isArray(b.items) ? b.items : [])
    .map((i) => ({ id: Math.floor(Number(i.id)), cost: Math.floor(Number(i.cost)) }))
    .filter((i) => Number.isInteger(i.id) && i.id > 0 && Number.isInteger(i.cost) && i.cost >= 100 && i.cost <= 200000)
    .slice(0, 300);
  if (!items.length) return NextResponse.json({ error: "no_items", message: "入力された仕入単価がありません（100〜200,000 円）" }, { status: 400 });
  const changed: { id: number; brand: string; from: number | null; to: number }[] = [];
  for (const it of items) {
    const cur = await get<{ id: number; brand: string; cost_excl_tax: number | null }>("SELECT id, brand, cost_excl_tax FROM sakes WHERE id = ? AND archived = 0", [it.id]);
    if (!cur || cur.cost_excl_tax === it.cost) continue;
    await run("UPDATE sakes SET cost_excl_tax = ?, updated_at = datetime('now','localtime') WHERE id = ?", [it.cost, it.id]);
    changed.push({ id: cur.id, brand: cur.brand, from: cur.cost_excl_tax, to: it.cost });
  }
  await audit("cost.set", { count: changed.length, changed });
  return NextResponse.json({ ok: true, changed });
}
