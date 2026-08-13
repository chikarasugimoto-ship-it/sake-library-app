import { all, audit } from "./db";
import { collectCupStats, type CupStat } from "./cups";
import { bottleCups, fmtMD } from "./types";
import { digestLabel } from "./notify";

// ============================================================================
// スマート日報（質重視）
// 毎日定時に走るが、「目立ったこと」があった日だけ本文を作る（0件の日は沈黙）。
// 拾うイベント:
//   1. 完売（当日の売切イベント。何日で完売・何杯出たか・速ければ次回本数の推奨）
//   2. 杯数の急伸（今週が先週の2倍以上）
//   3. 週間人気の首位交代
//   4. 人気銘柄の残りわずか（発注タイミングの示唆）
//   5. 品揃えギャップ（売れ筋の特定名称なのに提供中が手薄）
// 同じ内容を毎日繰り返さないよう、送信済みキーを audit_logs('brief.sent') に残して重複を抑える。
// 杯数は90mlグラス前提（1.8L=約20杯・720ml=約8杯）。
// ============================================================================

type SakeLite = {
  id: number;
  brand: string;
  grade: string;
  prefecture: string;
  status: string;
  stock_count: number | null;
  delivered_at: string;
  bottle_size: string;
};

type SoldoutEvent = { id: number; name: string; days: number | null; cups: number; deliveredAt: string; bottleSize: string };

export type BriefResult = {
  events: number; // イベント件数（0なら送らない）
  text: string; // LINE本文（events=0 なら空）
  keys: string[]; // 送信済み管理用のイベントキー
  sections: { soldout: number; surge: number; rank: number; low: number; gap: number };
};

const nameOf = (s: { brand: string; grade: string }) => [s.brand, s.grade].filter(Boolean).join(" ");

// 送信済みキー（直近8日）: 残数少・急伸・ギャップ等を毎日繰り返さない
async function sentKeys(): Promise<Set<string>> {
  const rows = await all<{ payload: string }>(
    "SELECT payload FROM audit_logs WHERE action = 'brief.sent' AND created_at >= datetime('now','localtime','-8 days')"
  );
  const set = new Set<string>();
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload) as { keys?: string[] };
      for (const k of p.keys ?? []) set.add(String(k));
    } catch {}
  }
  return set;
}

// 当日（直近24時間）の売切イベント
async function todaysSoldouts(): Promise<{ ev: SoldoutEvent; key: string }[]> {
  const rows = await all<{ payload: string; created_at: string }>(
    "SELECT payload, created_at FROM audit_logs WHERE action = 'sake.soldout_event' AND created_at >= datetime('now','localtime','-1 day') ORDER BY id"
  );
  const out: { ev: SoldoutEvent; key: string }[] = [];
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload) as SoldoutEvent;
      if (!p || !p.id) continue;
      out.push({ ev: p, key: `soldout:${p.id}:${(r.created_at || "").slice(0, 10)}` });
    } catch {}
  }
  return out;
}

export async function buildDailyBrief(): Promise<BriefResult> {
  const [sent, soldouts, cups, sakes] = await Promise.all([
    sentKeys(),
    todaysSoldouts(),
    collectCupStats(),
    all<SakeLite>(
      "SELECT id, brand, grade, prefecture, status, stock_count, delivered_at, bottle_size FROM sakes WHERE archived = 0"
    ),
  ]);
  const stat = (id: number): CupStat => cups.get(id) ?? { total: 0, d30: 0, d7: 0, prev7: 0 };

  const keys: string[] = [];
  const secSoldout: string[] = [];
  const secMove: string[] = [];
  const secLow: string[] = [];
  const secGap: string[] = [];

  // --- 1. 完売（当日）---
  const soldoutIds = new Set<number>();
  for (const { ev, key } of soldouts.slice(0, 6)) {
    if (sent.has(key)) continue;
    soldoutIds.add(ev.id);
    let line = `・${ev.name}：${ev.days != null ? digestLabel(ev.days) : "完売"}・${ev.cups}杯`;
    if (ev.deliveredAt) line += `（納品${fmtMD(ev.deliveredAt)}）`;
    if (ev.days != null && ev.days <= 3) {
      // 回転が速い＝機会損失。ペースから次回の本数目安（1.8L=20杯/720ml=8杯・90ml提供）
      const perBottle = bottleCups(ev.bottleSize);
      const weeklyPace = (ev.cups / Math.max(ev.days, 1)) * 7;
      const bottles = Math.min(3, Math.max(2, Math.ceil(weeklyPace / perBottle)));
      line += ` → ⚡回転速。次回は${bottles}本仕入れ推奨`;
    }
    secSoldout.push(line);
    keys.push(key);
  }

  // --- 2. 杯数の急伸（今週 vs 先週）---
  for (const s of sakes) {
    const c = stat(s.id);
    const key = `surge:${s.id}`;
    if (soldoutIds.has(s.id) || sent.has(key)) continue;
    if (c.d7 >= 6 && c.d7 > c.prev7 && c.d7 >= c.prev7 * 2) {
      secMove.push(`・🔥 ${nameOf(s)}：今週${c.d7}杯（先週${c.prev7}杯）と急伸`);
      keys.push(key);
      if (secMove.length >= 4) break;
    }
  }

  // --- 3. 週間人気の首位交代 ---
  const byD7 = [...sakes].sort((a, b) => stat(b.id).d7 - stat(a.id).d7);
  const byPrev7 = [...sakes].sort((a, b) => stat(b.id).prev7 - stat(a.id).prev7);
  const top = byD7[0];
  const prevTop = byPrev7[0];
  if (top && prevTop && top.id !== prevTop.id && stat(top.id).d7 >= 5 && stat(prevTop.id).prev7 >= 3) {
    const key = `rank1:${top.id}`;
    if (!sent.has(key)) {
      secMove.push(`・👑 週間人気の首位交代：${nameOf(top)}（7日${stat(top.id).d7}杯）が ${nameOf(prevTop)} を上回りました`);
      keys.push(key);
    }
  }

  // --- 4. 人気銘柄の残りわずか（残数管理中のみ）---
  for (const s of sakes) {
    if (s.status !== "available" || s.stock_count == null) continue;
    const c = stat(s.id);
    const key = `low:${s.id}`;
    if (sent.has(key)) continue;
    if (s.stock_count >= 1 && s.stock_count <= 5 && c.d7 >= 3) {
      secLow.push(`・⏳ ${nameOf(s)}：残り${s.stock_count}杯（7日で${c.d7}杯のペース）→ 発注検討`);
      keys.push(key);
      if (secLow.length >= 4) break;
    }
  }

  // --- 5. 品揃えギャップ（売れ筋の特定名称なのに提供中が手薄）---
  const cups30ByGrade = new Map<string, number>();
  const availByGrade = new Map<string, number>();
  let cups30Total = 0;
  for (const s of sakes) {
    const g = (s.grade || "").trim();
    const c30 = stat(s.id).d30;
    cups30Total += c30;
    if (!g) continue;
    cups30ByGrade.set(g, (cups30ByGrade.get(g) ?? 0) + c30);
    if (s.status === "available") availByGrade.set(g, (availByGrade.get(g) ?? 0) + 1);
  }
  if (cups30Total >= 20) {
    const gaps = [...cups30ByGrade.entries()]
      .filter(([g, n]) => n >= cups30Total * 0.2 && (availByGrade.get(g) ?? 0) <= 1)
      .sort((a, b) => b[1] - a[1]);
    for (const [g, n] of gaps.slice(0, 2)) {
      const key = `gap:${g}`;
      if (sent.has(key)) continue;
      const avail = availByGrade.get(g) ?? 0;
      secGap.push(`・🧭 ${g}系が売れ筋（30日${n}杯）ですが提供中${avail === 0 ? "ゼロ" : `${avail}銘柄のみ`} → 補充候補`);
      keys.push(key);
    }
  }

  const events = secSoldout.length + secMove.length + secLow.length + secGap.length;
  let text = "";
  if (events > 0) {
    const today = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" }).format(new Date());
    const parts: string[] = [`🍶 酒コレ日報（${today}）`];
    if (secSoldout.length) parts.push("", "■ 本日の完売", ...secSoldout);
    if (secMove.length) parts.push("", "■ 動きの変化", ...secMove);
    if (secLow.length) parts.push("", "■ 残りわずか", ...secLow);
    if (secGap.length) parts.push("", "■ 品揃えの示唆", ...secGap);
    text = parts.join("\n");
  }

  return {
    events,
    text,
    keys,
    sections: { soldout: secSoldout.length, surge: secMove.filter((l) => l.includes("🔥")).length, rank: secMove.filter((l) => l.includes("👑")).length, low: secLow.length, gap: secGap.length },
  };
}

// 送信済みキーの記録（cron本体から送信成功時に呼ぶ）
export async function markBriefSent(keys: string[], sent: boolean): Promise<void> {
  await audit("brief.sent", { keys, sent });
}
