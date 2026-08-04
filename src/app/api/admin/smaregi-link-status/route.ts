import { NextResponse } from "next/server";
import { all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { toSake } from "@/lib/types";
import { smaregiConfigured, listWaiterMenus, resolveMenuFor, waiterMenuName } from "@/lib/smaregi";

export const dynamic = "force-dynamic";

type Row = SakeRow & { smaregi_product_id: string };

// 各銘柄が「ウェイターに専用メニューとして登録済みか」を判定して返す。
// 連携済み＝会計レシートで銘柄ごとに分かれる。未登録＝共通メニューにフォールバック（同額はまとまる）。
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!smaregiConfigured()) return NextResponse.json({ error: "smaregi_unconfigured" }, { status: 503 });

  let menus;
  try {
    menus = await listWaiterMenus();
  } catch (e) {
    return NextResponse.json({ error: "smaregi_error", detail: String(e).slice(0, 200) }, { status: 502 });
  }

  const rows = await all<Row>(
    `SELECT ${SAKE_COLUMNS}, smaregi_product_id FROM sakes WHERE archived = 0 ORDER BY sort_order, id`
  );

  const items = rows.map((row) => {
    const s = toSake(row);
    const linked = !!resolveMenuFor(menus, { smaregiProductId: row.smaregi_product_id, brand: s.brand, grade: s.grade });
    return {
      id: s.id,
      menuName: waiterMenuName(s), // ウェイターに作るべきメニュー名（＝レシート表記）
      price: s.price ?? null,
      linked,
    };
  });

  const linkedCount = items.filter((i) => i.linked).length;
  return NextResponse.json({
    ok: true,
    total: items.length,
    linked: linkedCount,
    unlinked: items.length - linkedCount,
    items,
  });
}
