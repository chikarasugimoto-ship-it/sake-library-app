import { get, audit } from "./db";
import { digestDays, fmtMD } from "./types";
import { cupsSince } from "./cups";

// ============================================================================
// LINE通知（sugidama-os の通知窓口 /api/office/notify を呼ぶ）
// - 通知の出口は「夜のスマート日報」1本のみ（2026-08-14 オーナー指示。売切の即時通知はしない）
// - sake-library 自身は LINE のクレデンシャルを持たない（既存基盤の再利用・安全側）
// - 必要な環境変数: OFFICE_NOTIFY_TOKEN（sugidama-os と同じ値）
//   任意: OFFICE_NOTIFY_URL（既定 https://sugidama-os.vercel.app/api/office/notify）
//         SAKE_NOTIFY_TARGET（既定 "owner"=杉本さん個人push。"group"で「すぎだま社内」へ）
// - 未設定なら何もしない（通知だけ無効・アプリ本体は通常どおり動く）
// ============================================================================

const DEFAULT_URL = "https://sugidama-os.vercel.app/api/office/notify";

export function notifyConfigured(): boolean {
  return !!process.env.OFFICE_NOTIFY_TOKEN;
}

export async function notifyOffice(text: string): Promise<boolean> {
  const token = process.env.OFFICE_NOTIFY_TOKEN;
  if (!token || !text.trim()) return false;
  const url = process.env.OFFICE_NOTIFY_URL || DEFAULT_URL;
  const target = process.env.SAKE_NOTIFY_TARGET === "group" ? "group" : "owner";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, target, text }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function digestLabel(days: number | null): string {
  if (days == null) return "";
  return days === 0 ? "当日完売" : `${days}日で完売`;
}

// 売切イベントの記録（LINEは送らない。夜のスマート日報がここから拾ってまとめて報告する）。
// soldout_at は再納品で上書きされるため、売切「時点」の事実（何日で完売・何杯出たか）を
// audit_logs に確定値で残しておく＝日報時点でデータが消えていても正しく報告できる。
// 呼び出しは「提供中→売切」に切り替わった瞬間だけ（手動切替・残数0・注文の自動売切）。
export async function recordSoldoutEvent(sakeId: number): Promise<void> {
  try {
    const row = await get<{ brand: string; grade: string; delivered_at: string; soldout_at: string; bottle_size: string }>(
      "SELECT brand, grade, delivered_at, soldout_at, bottle_size FROM sakes WHERE id = ?",
      [sakeId]
    );
    if (!row) return;
    const name = [row.brand, row.grade].filter(Boolean).join(" ");
    const cups = await cupsSince(sakeId, row.delivered_at);
    const days = digestDays(row.delivered_at, row.soldout_at);
    await audit("sake.soldout_event", {
      id: sakeId,
      name,
      days, // 納品→売切の日数（納品日不明なら null）
      cups, // この瓶で出た杯数（90mlグラス換算＝注文実績の合計）
      deliveredAt: row.delivered_at || "",
      bottleSize: row.bottle_size || "1.8L",
    });
  } catch (e) {
    await audit("sake.soldout_event_failed", { id: sakeId, detail: String(e).slice(0, 150) });
  }
}
