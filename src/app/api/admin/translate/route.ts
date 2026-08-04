import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { all, get, run, audit } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { aiAvailable, translateSakesToEn, type SakeTranslateIn } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function parseArr(s?: string): string[] {
  try {
    const a = JSON.parse(s || "[]");
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

async function counts() {
  const t = await get<{ n: number }>("SELECT COUNT(*) AS n FROM sakes WHERE archived = 0");
  const d = await get<{ n: number }>("SELECT COUNT(*) AS n FROM sakes WHERE archived = 0 AND i18n IS NOT NULL AND i18n <> ''");
  const total = Number(t?.n) || 0;
  const done = Number(d?.n) || 0;
  return { total, done, remaining: total - done };
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ configured: aiAvailable(), ...(await counts()) });
}

// 未英訳の日本酒を最大LIMIT件まとめてAI英訳して保存。残りはクライアントが続けて呼ぶ（resumable）。
export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiAvailable()) return NextResponse.json({ error: "AIキーが未設定です（ANTHROPIC_API_KEY）" }, { status: 503 });
  const LIMIT = 3;
  const rows = await all<{ id: number; brand: string; sub_name: string; brewery: string; prefecture: string; grade: string; description: string; taste_tags: string; pairings: string; kuchijo: string | null }>(
    `SELECT s.id, s.brand, s.sub_name, s.brewery, s.prefecture, s.grade, s.description, s.taste_tags, s.pairings, g.kuchijo
       FROM sakes s LEFT JOIN gods g ON g.sake_id = s.id
      WHERE s.archived = 0 AND (s.i18n IS NULL OR s.i18n = '')
      ORDER BY s.sort_order, s.id LIMIT ?`,
    [LIMIT]
  );
  if (!rows.length) {
    return NextResponse.json({ ok: true, translated: 0, ...(await counts()) });
  }
  const input: SakeTranslateIn[] = rows.map((r) => ({
    id: r.id,
    brand: r.brand,
    subName: r.sub_name,
    brewery: r.brewery,
    prefecture: r.prefecture,
    grade: r.grade,
    description: r.description,
    tasteTags: parseArr(r.taste_tags),
    pairings: parseArr(r.pairings),
    kuchijo: r.kuchijo || "",
  }));
  // まとめて英訳。AI応答のJSONが崩れた時は1件ずつにフォールバック（壊れた1件で全体を止めない）。
  let outs: Awaited<ReturnType<typeof translateSakesToEn>> = [];
  try {
    outs = await translateSakesToEn(input);
  } catch {
    for (const it of input) {
      try {
        outs.push(...(await translateSakesToEn([it])));
      } catch {
        // この1件は今回スキップ（次回の再実行で再挑戦）
      }
    }
  }
  let translated = 0;
  const byId = new Map(outs.map((o) => [o.id, o]));
  for (const r of rows) {
    const o = byId.get(r.id);
    if (!o) continue;
    await run("UPDATE sakes SET i18n = ?, updated_at = datetime('now','localtime') WHERE id = ?", [JSON.stringify({ en: o.en }), r.id]);
    if (o.kuchijoEn && r.kuchijo) await run("UPDATE gods SET kuchijo_en = ? WHERE sake_id = ?", [o.kuchijoEn, r.id]);
    translated++;
  }
  revalidatePath("/");
  revalidatePath("/zukan");
  await audit("sake.translate", { translated });
  return NextResponse.json({ ok: true, translated, ...(await counts()) });
}
