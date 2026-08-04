import { NextRequest, NextResponse } from "next/server";
import { all, audit, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake, daysSinceDelivery } from "@/lib/types";
import { recommendSake, aiAvailable, type SakeForRec } from "@/lib/ai";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// AIソムリエ：本日提供中の日本酒から、好みに合う一本を提案
export async function POST(req: NextRequest) {
  if (!aiAvailable()) return NextResponse.json({ error: "ai_unconfigured" }, { status: 503 });
  // コスト暴走・スパム対策：同一IPからの連投を制限（通常利用は十分余裕のある値）
  if (!rateLimit("rec:" + clientIp(req), 40, 60_000)) {
    return NextResponse.json({ error: "rate_limited", message: "少し時間をおいてお試しください" }, { status: 429 });
  }

  const b = (await req.json().catch(() => ({}))) as { prefs?: string[]; text?: string; lang?: string };
  const prefs = Array.isArray(b.prefs) ? b.prefs.map(String).slice(0, 8) : [];
  const text = String(b.text ?? "").slice(0, 200);
  const lang = b.lang === "en" ? "en" : "ja";

  // 本日提供中（売切・隠し酒・アーカイブは除外）
  const rows = await all<SakeRow>(
    `SELECT ${SAKE_COLUMNS} FROM sakes WHERE archived = 0 AND is_hidden = 0 AND status != 'soldout' AND photo IS NOT NULL ORDER BY sort_order, id`
  );
  const sakes = rows.map(toSake);
  const now = Date.now();
  const forRec: SakeForRec[] = sakes.map((s) => ({
    id: s.id,
    brand: s.brand,
    grade: s.grade,
    prefecture: s.prefecture,
    price: s.price,
    isPremium: s.isPremium,
    tasteTags: s.tasteTags,
    tasteChart: s.tasteChart,
    description: s.description,
    fresh: s.freshSensitive,
    openDays: s.freshSensitive ? daysSinceDelivery(s.openedAt, now) : null,
  }));

  let recs;
  try {
    recs = await recommendSake(prefs, text, forRec, lang);
  } catch (e) {
    return NextResponse.json({ error: "ai_error", detail: String(e).slice(0, 200) }, { status: 502 });
  }

  // 仕入れ分析用に相談内容を記録（好み・自由文・薦めた銘柄）
  await audit("ai.recommend", { prefs, text, picked: recs.map((r) => r.sakeId) });

  // 表示用に銘柄情報をマージ
  const byId = new Map(sakes.map((s) => [s.id, s]));
  const items = recs
    .map((r) => {
      const s = byId.get(r.sakeId);
      if (!s) return null;
      return { id: s.id, brand: s.brand, grade: s.grade, prefecture: s.prefecture, price: s.price, volume: s.volume, isPremium: s.isPremium, reason: r.reason };
    })
    .filter(Boolean);

  return NextResponse.json({ items });
}
