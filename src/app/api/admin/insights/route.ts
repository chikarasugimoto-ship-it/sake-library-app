import { NextResponse } from "next/server";
import { all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { toSake, digestDays, daysSinceDelivery } from "@/lib/types";
import { analyzePurchasing, aiAvailable, type PurchaseData } from "@/lib/ai";

const DAYS = 30;

// 注文実績＋AI相談（好み）＋在庫を集計し、AIに仕入れ提案を出させる
export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiAvailable()) return NextResponse.json({ error: "ai_unconfigured" }, { status: 503 });

  const logs = await all<{ action: string; payload: string }>(
    `SELECT action, payload FROM audit_logs
     WHERE action IN ('order.placed','ai.recommend')
       AND created_at >= datetime('now','localtime','-${DAYS} days')
     ORDER BY id DESC LIMIT 5000`
  );

  const orderQty = new Map<number, number>();
  const prefCount = new Map<string, number>();
  const pickCount = new Map<number, number>();
  const texts: string[] = [];
  for (const l of logs) {
    let p: { items?: { sakeId: number; quantity: number }[]; prefs?: string[]; text?: string; picked?: number[] };
    try {
      p = JSON.parse(l.payload);
    } catch {
      continue;
    }
    if (l.action === "order.placed") {
      for (const it of p.items ?? []) orderQty.set(Number(it.sakeId), (orderQty.get(Number(it.sakeId)) ?? 0) + (Number(it.quantity) || 1));
    } else if (l.action === "ai.recommend") {
      for (const pr of p.prefs ?? []) prefCount.set(String(pr), (prefCount.get(String(pr)) ?? 0) + 1);
      if (p.text && String(p.text).trim() && texts.length < 15) texts.push(String(p.text).trim().slice(0, 60));
      for (const sid of p.picked ?? []) pickCount.set(Number(sid), (pickCount.get(Number(sid)) ?? 0) + 1);
    }
  }

  const rows = await all<SakeRow>(`SELECT ${SAKE_COLUMNS} FROM sakes WHERE archived = 0 ORDER BY sort_order, id`);
  const sakes = rows.map(toSake);
  const byId = new Map(sakes.map((s) => [s.id, s]));
  const nameOf = (id: number) => {
    const s = byId.get(id);
    return s ? [s.brand, s.grade].filter(Boolean).join(" ") : "（提供終了）";
  };
  const tagsOf = (id: number) => byId.get(id)?.tasteTags ?? [];
  const nameOfSake = (s: (typeof sakes)[number]) => [s.brand, s.grade].filter(Boolean).join(" ");

  // 消化日数：完売した銘柄の納品→売切日数（速い順）と、在庫が長い銘柄（経過日数の長い順）
  const now = Date.now();
  const soldoutSpeed = sakes
    .map((s) => ({ name: nameOfSake(s), days: digestDays(s.deliveredAt, s.soldoutAt) }))
    .filter((x): x is { name: string; days: number } => x.days != null)
    .sort((a, b) => a.days - b.days)
    .slice(0, 12);
  const SLOW_DAYS = 14;
  const slowMovers = sakes
    .filter((s) => s.status !== "soldout")
    .map((s) => ({ name: nameOfSake(s), days: daysSinceDelivery(s.deliveredAt, now) }))
    .filter((x): x is { name: string; days: number } => x.days != null && x.days >= SLOW_DAYS)
    .sort((a, b) => b.days - a.days)
    .slice(0, 12);

  const data: PurchaseData = {
    days: DAYS,
    orders: [...orderQty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, qty]) => ({ name: nameOf(id), tasteTags: tagsOf(id), qty })),
    aiPrefs: [...prefCount.entries()].sort((a, b) => b[1] - a[1]).map(([pref, count]) => ({ pref, count })),
    aiTexts: texts,
    aiPicked: [...pickCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, count]) => ({ name: nameOf(id), count })),
    stock: sakes.map((s) => ({ name: nameOfSake(s), tasteTags: s.tasteTags, status: s.status })),
    soldoutSpeed,
    slowMovers,
  };

  const hasData = orderQty.size > 0 || prefCount.size > 0;

  try {
    const insight = await analyzePurchasing(data);
    return NextResponse.json({ ok: true, hasData, days: DAYS, insight, counts: { orders: orderQty.size, aiQueries: logs.filter((l) => l.action === "ai.recommend").length } });
  } catch (e) {
    return NextResponse.json({ error: "ai_error", detail: String(e).slice(0, 200) }, { status: 502 });
  }
}
