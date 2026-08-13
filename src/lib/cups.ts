import { all } from "./db";

// ============================================================================
// 杯数カウント（発注判断のためのデータ）
// AI仕入れ提案(/api/admin/insights)と同じ audit_logs の 'order.placed' を集計する。
// payload.items = [{sakeId, quantity, ...}]。新テーブルは作らず既存の注文実績をそのまま使う。
// 注意: DBの created_at は datetime('now','localtime') ＝「DBサーバーの時計」。
//       比較はJSの new Date(naive文字列)＝同じサーバー時計で解釈されるため一貫する。
// ============================================================================

export type CupStat = {
  total: number; // 累計杯数（記録が残っている全期間）
  d30: number; // 直近30日
  d7: number; // 直近7日
  prev7: number; // その前の7日（8〜14日前）＝急伸判定の比較用
};

type OrderLog = { payload: string; created_at: string };

function parseTs(ts: string): number | null {
  if (!ts) return null;
  const d = new Date(ts.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

async function orderLogs(): Promise<OrderLog[]> {
  // 1店舗運用でログ件数は小さい想定。念のため上限つき（新しい順）
  return all<OrderLog>(
    "SELECT payload, created_at FROM audit_logs WHERE action = 'order.placed' ORDER BY id DESC LIMIT 20000"
  );
}

function eachItem(log: OrderLog, cb: (sakeId: number, qty: number) => void) {
  let p: { items?: { sakeId: number; quantity: number }[] };
  try {
    p = JSON.parse(log.payload);
  } catch {
    return;
  }
  for (const it of p.items ?? []) {
    const id = Number(it.sakeId);
    const qty = Math.max(0, Number(it.quantity) || 0);
    if (id && qty) cb(id, qty);
  }
}

// 全銘柄の杯数統計をまとめて集計（在庫ボード・日報cron用）
export async function collectCupStats(): Promise<Map<number, CupStat>> {
  const logs = await orderLogs();
  const now = Date.now();
  const DAY = 86_400_000;
  const t30 = now - 30 * DAY;
  const t7 = now - 7 * DAY;
  const t14 = now - 14 * DAY;
  const map = new Map<number, CupStat>();
  for (const l of logs) {
    const ts = parseTs(l.created_at);
    eachItem(l, (id, qty) => {
      const s = map.get(id) ?? { total: 0, d30: 0, d7: 0, prev7: 0 };
      s.total += qty;
      if (ts != null) {
        if (ts >= t30) s.d30 += qty;
        if (ts >= t7) s.d7 += qty;
        else if (ts >= t14) s.prev7 += qty;
      }
      map.set(id, s);
    });
  }
  return map;
}

// この瓶ぶんの杯数＝納品日時以降の注文数（納品日不明なら全期間）。売切通知の「出た杯数」に使う
export async function cupsSince(sakeId: number, sinceTs: string): Promise<number> {
  const logs = await orderLogs();
  const since = parseTs(sinceTs);
  let n = 0;
  for (const l of logs) {
    if (since != null) {
      const ts = parseTs(l.created_at);
      if (ts != null && ts < since) continue;
    }
    eachItem(l, (id, qty) => {
      if (id === sakeId) n += qty;
    });
  }
  return n;
}
