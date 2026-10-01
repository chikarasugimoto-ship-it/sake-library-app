import { NextRequest, NextResponse } from "next/server";
import { all, run, audit } from "@/lib/db";
import { consumeSakeStock } from "@/lib/stock-consume";
import { CUPS, normalizeSize, priceFor, type SakeSize } from "@/lib/sizes";

// ============================================================================
// MO（モバイルオーダー sugidama-mo）で日本酒が注文されたら、酒コレの残数も減らす。
//   POST /api/order/consume?token=...   Body: { orderId, table?, items: [{ sakeId, size?, quantity }] }
//
// 背景（2026-09-30 オーナー「残数1にしてるのに普通に注文できる」）:
//   残数（stock_count）を減らすのは酒コレ自身の注文画面だけで、MOからの注文は酒コレに何も伝えていなかった。
//   → MOは注文確定後にここへ杯数を送り、酒コレ側は自分の注文と同じ処理（減算→0で自動売切）を通す。
//
// 決めごと:
//   - 認証: ?token= が MO_KITCHEN_TOKEN（酒コレ→KM橋渡しで既にMOと共有している鍵）か SAKE_BRIDGE_SECRET に一致。
//     どちらも未設定なら 503（＝連携OFF）。MO側は失敗しても注文を止めない（監査だけ残す）。
//   - 冪等: ext_ref = "mo:<MOの注文ID>" を mo_consumed に先に入れる。既にあれば何もしない（dedup=true）。
//   - 集計: 在庫ボードの「30日◯杯・累計◯杯」は audit_logs の order.placed を数えているので、
//     同じ形（items[].sakeId / quantity / cups）で source:"mo" を付けて残す＝MOの杯数も集計に入る。
// ============================================================================

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean | null {
  const accepted = [process.env.MO_KITCHEN_TOKEN, process.env.SAKE_BRIDGE_SECRET].filter((v): v is string => !!v);
  if (!accepted.length) return null;
  const token =
    req.nextUrl.searchParams.get("token") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    "";
  return !!token && accepted.includes(token);
}

type SakeRow = { id: number; brand: string; price: number | null; stock_count: number | null; status: string };

export async function POST(req: NextRequest) {
  const auth = authorized(req);
  if (auth === null) return NextResponse.json({ ok: false, error: "unconfigured" }, { status: 503 });
  if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const b = (await req.json().catch(() => ({}))) as { orderId?: unknown; table?: unknown; items?: unknown };
  const orderId = String(b.orderId ?? "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40);
  if (!orderId) return NextResponse.json({ ok: false, error: "no_order_id" }, { status: 400 });
  if (!Array.isArray(b.items)) return NextResponse.json({ ok: false, error: "no_items" }, { status: 400 });
  const table = String(b.table ?? "").trim().slice(0, 12);

  // 明細の正規化（銘柄×サイズでまとめる・1〜99）
  type Line = { sakeId: number; size: SakeSize; quantity: number };
  const merged = new Map<string, Line>();
  for (const raw of b.items.slice(0, 50)) {
    if (typeof raw !== "object" || raw === null) continue;
    const it = raw as { sakeId?: unknown; size?: unknown; quantity?: unknown; qty?: unknown };
    const sakeId = Math.floor(Number(it.sakeId));
    const quantity = Math.floor(Number(it.quantity ?? it.qty));
    if (!Number.isInteger(sakeId) || sakeId <= 0 || !Number.isInteger(quantity) || quantity <= 0) continue;
    const size = normalizeSize(it.size);
    const key = `${sakeId}|${size}`;
    const cur = merged.get(key);
    if (cur) cur.quantity = Math.min(99, cur.quantity + quantity);
    else merged.set(key, { sakeId, size, quantity: Math.min(99, quantity) });
  }
  const lines = [...merged.values()];
  if (!lines.length) return NextResponse.json({ ok: false, error: "no_items" }, { status: 400 });

  // 冪等キー（同じMO注文の再送は二度減らさない）
  const extRef = `mo:${orderId}`;
  const ins = await run("INSERT OR IGNORE INTO mo_consumed (ext_ref, payload) VALUES (?, ?)", [
    extRef,
    JSON.stringify({ table, items: lines }).slice(0, 2000),
  ]);
  if (ins.rowsAffected === 0) return NextResponse.json({ ok: true, dedup: true, consumed: [] });

  const ids = [...new Set(lines.map((l) => l.sakeId))];
  const rows = await all<SakeRow>(
    `SELECT id, brand, price, stock_count, status FROM sakes WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  const ordered = lines
    .filter((l) => byId.has(l.sakeId))
    .map((l) => {
      const s = byId.get(l.sakeId)!;
      return {
        sakeId: s.id,
        quantity: l.quantity,
        size: l.size,
        cups: l.quantity * CUPS[l.size],
        price: priceFor(Number(s.price) || 0, l.size),
        brand: s.brand,
      };
    });
  const unknown = lines.filter((l) => !byId.has(l.sakeId)).map((l) => l.sakeId);

  // 在庫ボードの杯数集計（cups.ts / insights）が読む order.placed と同じ形で残す
  await audit("order.placed", {
    source: "mo",
    extRef,
    table,
    orderId,
    setKind: "single",
    total: ordered.reduce((n, o) => n + o.price * o.quantity, 0),
    items: ordered,
    unresolved: unknown.length,
  });

  const result = await consumeSakeStock(ordered);

  const after = ordered.length
    ? await all<SakeRow>(
        `SELECT id, brand, price, stock_count, status FROM sakes WHERE id IN (${ordered.map(() => "?").join(",")})`,
        ordered.map((o) => o.sakeId)
      )
    : [];
  return NextResponse.json({
    ok: true,
    dedup: false,
    consumed: after.map((r) => ({ sakeId: r.id, brand: r.brand, stockCount: r.stock_count, status: r.status })),
    soldout: result.soldout,
    unknown,
  });
}
