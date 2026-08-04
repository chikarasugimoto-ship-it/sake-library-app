import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { all, run, audit, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { toSake } from "@/lib/types";
import { rarityFor, region8For, breweryKey } from "@/lib/sakegami";
import { enrichGodMeta, aiAvailable } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // AI補完に時間がかかるため上限を延長（プラン上限までクランプ）

// 現在の酒神メタ一覧（管理画面の確認用）
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await all<{ sake_id: number; name: string; rarity: string; kuchijo: string; region8: string; brand: string; grade: string; prefecture: string; brewery: string; has_art: number; god_updated: string }>(
    `SELECT g.sake_id, g.name, g.rarity, g.kuchijo, g.region8, s.brand, s.grade, s.prefecture, s.brewery,
            (g.god_art IS NOT NULL) AS has_art, g.updated_at AS god_updated
       FROM gods g JOIN sakes s ON s.id = g.sake_id
      WHERE s.archived = 0 ORDER BY s.sort_order, s.id`
  );
  return NextResponse.json({ gods: rows });
}

// 酒神メタを一括生成（冪等・既存 is_legend/name/kuchijo は保持）。
// パス1: レア度・地方は機械的に確定して**先に全銘柄へ即書き込み**（AI不要・速い・確実）。
// パス2: AIで酒神名・口上を生成し、産地/蔵元の空欄を補完（チャンクごとに永続化＝途中で落ちてもパス1は残る）。
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // 既定は決定論のみ（速い・確実）。AIで詩的な名前を磨くのは任意（aiNames=true・タイムアウトし得る）。
  const body = (await req.json().catch(() => ({}))) as { aiNames?: boolean };
  const useAI = body.aiNames === true && aiAvailable();

  const rows = await all<SakeRow & { brewery: string }>(`SELECT ${SAKE_COLUMNS}, brewery FROM sakes WHERE archived = 0 ORDER BY sort_order, id`);
  const sakes = rows.map(toSake);

  // 既存の gods（手動 is_legend・既存の名前/口上を保持）
  const existingRows = await all<{ sake_id: number; is_legend: number; name: string; kuchijo: string }>("SELECT sake_id, is_legend, name, kuchijo FROM gods");
  const existing = new Map(existingRows.map((r) => [r.sake_id, r]));

  // ===== パス1: 決定論メタを全銘柄へ即upsert（rarity/region8/brewery_key） =====
  const byRarity: Record<string, number> = {};
  let withRegion = 0;
  for (const s of sakes) {
    const ex = existing.get(s.id);
    const rarity = rarityFor({ price: s.price, grade: s.grade, seasonLabel: s.seasonLabel, isHidden: s.isHidden, brand: s.brand, isLegend: !!ex?.is_legend });
    const region = region8For(s.prefecture);
    // 名前の決定論フォールバック＝銘柄名そのもの（モンスター名はキャラ絵生成時にAIが付ける）。既存名は保持。
    const fallbackName = s.brand.slice(0, 20);
    await run(
      `INSERT INTO gods (sake_id, store_id, name, rarity, kuchijo, region8, brewery_key, is_legend, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT(sake_id) DO UPDATE SET
         name = CASE WHEN gods.name = '' OR gods.name IS NULL THEN excluded.name ELSE gods.name END,
         rarity = excluded.rarity, region8 = excluded.region8, brewery_key = excluded.brewery_key, updated_at = excluded.updated_at`,
      [s.id, ex?.name || fallbackName, rarity, ex?.kuchijo || "", region, breweryKey(s.brewery), ex?.is_legend ? 1 : 0]
    );
    byRarity[rarity] = (byRarity[rarity] || 0) + 1;
    if (region) withRegion++;
  }
  // ここまででレア度フレーム・制覇は動く。客向けを即反映。
  revalidatePath("/");
  revalidatePath("/zukan");

  // ===== パス2: AIで酒神名・口上＋産地/蔵元の空欄補完（best-effort・10件ずつ永続化） =====
  let prefBackfilled = 0;
  let breweryBackfilled = 0;
  let aiNamed = 0;
  if (useAI) {
    const byId = new Map(sakes.map((s) => [s.id, s]));
    // まだAI名が付いていない（空 or フォールバック「銘柄の神」）銘柄だけを対象に＝押すたびに先へ進む
    const need = sakes
      .filter((s) => {
        const n = existing.get(s.id)?.name || "";
        return !n || n === s.brand.slice(0, 20);
      })
      .map((s) => ({ id: s.id, brand: s.brand, grade: s.grade, brewery: s.brewery, prefecture: s.prefecture }));
    for (let i = 0; i < need.length; i += 10) {
      let out: Awaited<ReturnType<typeof enrichGodMeta>> = [];
      try {
        out = await enrichGodMeta(need.slice(i, i + 10));
      } catch {
        out = [];
      }
      for (const o of out) {
        const s = byId.get(o.id);
        if (!s) continue;
        let prefecture = s.prefecture;
        let brewery = s.brewery;
        if (!prefecture && o.prefecture) { prefecture = o.prefecture; prefBackfilled++; }
        if (!brewery && o.brewery) { brewery = o.brewery; breweryBackfilled++; }
        if (prefecture !== s.prefecture || brewery !== s.brewery) {
          await run("UPDATE sakes SET prefecture = ?, brewery = ?, updated_at = datetime('now','localtime') WHERE id = ?", [prefecture, brewery, s.id]);
        }
        const name = (o.godName || "").slice(0, 20);
        const kuchijo = (o.kuchijo || "").slice(0, 60);
        // 名前・口上は空でない時だけ上書き。地方/蔵キーは補完後の値で更新。
        await run(
          `UPDATE gods SET
             name = CASE WHEN ? <> '' THEN ? ELSE name END,
             kuchijo = CASE WHEN ? <> '' THEN ? ELSE kuchijo END,
             region8 = ?, brewery_key = ?, updated_at = datetime('now','localtime')
           WHERE sake_id = ?`,
          [name, name, kuchijo, kuchijo, region8For(prefecture), breweryKey(brewery), s.id]
        );
        if (name) aiNamed++;
      }
    }
    revalidatePath("/");
    revalidatePath("/zukan");
  }

  await audit("sakegami.sync", { total: sakes.length, aiUsed: useAI, aiNamed, prefBackfilled, breweryBackfilled, byRarity });
  return NextResponse.json({ ok: true, total: sakes.length, aiUsed: useAI, aiNamed, prefBackfilled, breweryBackfilled, withRegion, byRarity });
}
