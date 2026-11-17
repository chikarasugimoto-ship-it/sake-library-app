import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { all, get, run, audit, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { isOwner } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/pricing";
import { buildRepriceRows, type RepriceInput } from "@/lib/reprice";
import { toSake } from "@/lib/types";
import { smaregiConfigured, updateSakeProduct } from "@/lib/smaregi";

// 売価の見直し（管理者のみ・2026-11-18）。
//  GET  ?maxRate=0.30&minPrice=800&unit=100 … いま販売している銘柄（アーカイブ以外）の 原価・今の売価と原価率・提案売価 を返す（何も変えない）
//  POST { items: [{ id, price }], applySettings?: { maxRate, minPrice, unit } }
//       … 指定した銘柄の 90ml 売価(税込) を変更（1 合は自動で 2 倍）。スマレジ商品の価格も更新（失敗しても売価変更は成立・結果に載せる）。
//          applySettings があれば、今後の納品書スキャンの自動計算にも同じ上限・最低売価を使う。
export const dynamic = "force-dynamic";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function readOpts(maxRate: unknown, minPrice: unknown, unit: unknown, base: { minPrice: number; roundUnit: number }) {
  const mr = Number(maxRate);
  const mp = Number(minPrice);
  const u = Number(unit);
  return {
    maxRate: Number.isFinite(mr) && mr > 0 ? clamp(mr, 0.1, 0.6) : 0.3,
    minPrice: Number.isFinite(mp) && mp >= 0 ? clamp(Math.floor(mp), 0, 5000) : base.minPrice,
    roundUnit: Number.isFinite(u) && u > 0 ? clamp(Math.floor(u), 10, 500) : base.roundUnit || 100,
  };
}

async function loadSakes(): Promise<RepriceInput[]> {
  return all<RepriceInput>(
    `SELECT id, brand, COALESCE(kubun,'通常') AS kubun, COALESCE(bottle_size,'1.8L') AS bottle_size, status, price, cost_excl_tax,
            COALESCE(smaregi_product_id,'') AS smaregi_product_id
       FROM sakes WHERE archived = 0 ORDER BY sort_order, id`
  );
}

export async function GET(req: NextRequest) {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const settings = await getSettings();
  const sp = req.nextUrl.searchParams;
  const opts = readOpts(sp.get("maxRate"), sp.get("minPrice") ?? undefined, sp.get("unit") ?? undefined, settings);
  const rows = buildRepriceRows(await loadSakes(), settings, opts);
  return NextResponse.json({ ok: true, opts, taxRate: settings.taxRate, rows });
}

export async function POST(req: NextRequest) {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as {
    items?: Array<{ id?: unknown; price?: unknown }>;
    applySettings?: { maxRate?: unknown; minPrice?: unknown; unit?: unknown };
  };
  const items = (Array.isArray(b.items) ? b.items : [])
    .map((i) => ({ id: Math.floor(Number(i.id)), price: Math.floor(Number(i.price)) }))
    .filter((i) => Number.isInteger(i.id) && i.id > 0 && Number.isInteger(i.price) && i.price >= 100 && i.price <= 50000);
  if (!items.length) return NextResponse.json({ error: "no_items", message: "変更する銘柄がありません" }, { status: 400 });
  if (items.length > 300) return NextResponse.json({ error: "too_many" }, { status: 400 });

  const changed: { id: number; brand: string; from: number | null; to: number }[] = [];
  const smaregiFailed: { id: number; brand: string; error: string }[] = [];
  let smaregiUpdated = 0;
  for (const it of items) {
    const cur = await get<{ id: number; brand: string; price: number | null }>("SELECT id, brand, price FROM sakes WHERE id = ? AND archived = 0", [it.id]);
    if (!cur || cur.price === it.price) continue;
    await run("UPDATE sakes SET price = ?, updated_at = datetime('now','localtime') WHERE id = ?", [it.price, it.id]);
    changed.push({ id: cur.id, brand: cur.brand, from: cur.price, to: it.price });
    // スマレジ商品（券売機・レジ）の価格も合わせる。失敗しても酒コレの売価変更は取り消さない
    if (smaregiConfigured()) {
      const row = await get<SakeRow & { smaregi_product_id: string }>(`SELECT ${SAKE_COLUMNS}, smaregi_product_id FROM sakes WHERE id = ?`, [it.id]);
      const pid = (row?.smaregi_product_id || "").trim();
      if (row && pid) {
        try {
          await updateSakeProduct(pid, toSake(row));
          smaregiUpdated++;
        } catch (e) {
          smaregiFailed.push({ id: cur.id, brand: cur.brand, error: e instanceof Error ? e.message.slice(0, 120) : "error" });
        }
      }
    }
  }
  let settingsSaved = false;
  if (b.applySettings) {
    const base = await getSettings();
    const o = readOpts(b.applySettings.maxRate, b.applySettings.minPrice, b.applySettings.unit, base);
    await saveSettings({ rateNormal: o.maxRate, ratePremium: o.maxRate, rateLimited: o.maxRate, minPrice: o.minPrice, roundUnit: o.roundUnit });
    settingsSaved = true;
  }
  await audit("price.reprice", { count: changed.length, changed, smaregiUpdated, smaregiFailed: smaregiFailed.length, settingsSaved });
  revalidatePath("/");
  return NextResponse.json({ ok: true, changed, smaregiUpdated, smaregiFailed, settingsSaved });
}
