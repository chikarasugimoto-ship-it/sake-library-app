"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RepriceRow } from "@/lib/reprice";

// 売価の見直し（管理者のみ・2026-11-18）。
// いま販売している銘柄の「仕入・1 杯原価・今の売価と原価率・提案売価」を一覧で見て、選んだものだけまとめて変更する。
// 提案売価 = 原価率が上限以下になる、いちばん安い売価（丸め単位で切り上げ・最低売価で下限）。1 合は 90ml の 2 倍のまま。
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const yen = (v: number | null) => (v == null ? "—" : `¥${v.toLocaleString()}`);

export function RepricePanel() {
  const [maxRate, setMaxRate] = useState("30");
  const [minPrice, setMinPrice] = useState("");
  const [rows, setRows] = useState<RepriceRow[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [applySettings, setApplySettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [denied, setDenied] = useState(false);

  const load = useCallback(async (rate: string, min: string) => {
    setBusy(true); setErr("");
    try {
      const q = new URLSearchParams({ maxRate: String((Number(rate) || 30) / 100) });
      if (min !== "") q.set("minPrice", min);
      const r = await fetch(`/api/admin/reprice?${q}`, { cache: "no-store" });
      if (r.status === 401) { setDenied(true); return; }
      const j = (await r.json()) as { rows: RepriceRow[]; opts: { minPrice: number } };
      setRows(j.rows);
      if (min === "") setMinPrice(String(j.opts.minPrice));
      // 既定では「提案と今の売価が違う」ものだけ選ぶ
      setPicked(new Set(j.rows.filter((x) => x.proposed != null && x.proposed !== x.price).map((x) => x.id)));
    } catch { setErr("読み込めませんでした"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load("30", ""); }, [load]);

  const changes = useMemo(() => rows.filter((r) => picked.has(r.id) && r.proposed != null && r.proposed !== r.price), [rows, picked]);
  const over = rows.filter((r) => r.rate != null && r.rate > (Number(maxRate) || 30) / 100 + 1e-9).length;
  const noCost = rows.filter((r) => r.cost == null).length;
  const down = changes.filter((r) => (r.price ?? 0) > (r.proposed ?? 0)).length;
  const up = changes.length - down;

  async function apply() {
    if (!changes.length || busy) return;
    if (!window.confirm(`${changes.length} 銘柄の 90ml 売価を変更します（値上げ ${up}・値下げ ${down}）。1 合は自動で 2 倍になります。お客様の画面にすぐ反映されます。よろしいですか？`)) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await fetch("/api/admin/reprice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: changes.map((c) => ({ id: c.id, price: c.proposed })),
          ...(applySettings ? { applySettings: { maxRate: (Number(maxRate) || 30) / 100, minPrice: Number(minPrice) || 0 } } : {}),
        }),
      });
      const j = (await r.json()) as { ok?: boolean; message?: string; changed?: unknown[]; smaregiUpdated?: number; smaregiFailed?: { brand: string }[] };
      if (!r.ok || !j.ok) { setErr(j.message || "変更できませんでした"); return; }
      const failed = j.smaregiFailed ?? [];
      setMsg(`${j.changed?.length ?? 0} 銘柄の売価を変更しました。スマレジの価格更新 ${j.smaregiUpdated ?? 0} 件${failed.length ? `・失敗 ${failed.length} 件（${failed.map((f) => f.brand).slice(0, 3).join("、")}）＝スマレジ連携の画面で「全件同期」をしてください` : ""}`);
      await load(maxRate, minPrice);
    } catch { setErr("通信に失敗しました"); }
    finally { setBusy(false); }
  }

  if (denied) return null;
  return (
    <section className="mx-auto max-w-lg px-6 pb-24">
      <h2 className="text-xl font-bold">売価の見直し</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        いま販売している銘柄の原価率を見て、売価をまとめて直します。提案売価は「原価率が上限以下になる、いちばん安い値段」です。
        原価率 = 1 杯原価（仕入 ÷ 提供杯数）÷ 売価(税抜)。90ml と 1 合（2 倍）は同じ原価率になります。
      </p>
      <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2 text-xs">
        <label>原価率の上限（%）
          <input value={maxRate} onChange={(e) => setMaxRate(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-xl border border-hairline bg-card px-3 py-2 text-sm" />
        </label>
        <label>最低売価（円・0 で無し）
          <input value={minPrice} onChange={(e) => setMinPrice(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-xl border border-hairline bg-card px-3 py-2 text-sm" />
        </label>
        <button onClick={() => void load(maxRate, minPrice)} disabled={busy} className="rounded-xl bg-card px-3 py-2 text-sm font-bold ring-1 ring-hairline disabled:opacity-50">計算し直す</button>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        {rows.length} 銘柄 ／ 上限を超えている {over} ／ 原価が未登録 {noCost}（提案できません。納品書スキャンか編集で仕入単価を入れてください）
      </p>
      {err && <p className="mt-2 text-xs text-[#b3261e]">{err}</p>}
      {msg && <p className="mt-2 rounded-xl bg-[#e8f5e9] px-3 py-2 text-xs text-[#1b7a3d]">{msg}</p>}

      <div className="mt-3 overflow-x-auto rounded-2xl bg-card shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
        <table className="w-full text-[11.5px]">
          <thead className="text-ink-soft">
            <tr className="border-b border-hairline">
              <th className="px-2 py-2"></th>
              <th className="px-2 py-2 text-left font-medium">銘柄</th>
              <th className="px-2 py-2 text-right font-medium">仕入</th>
              <th className="px-2 py-2 text-right font-medium">1杯原価</th>
              <th className="px-2 py-2 text-right font-medium">今</th>
              <th className="px-2 py-2 text-right font-medium">提案</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.proposed != null && r.proposed !== r.price;
              const isOver = r.rate != null && r.rate > (Number(maxRate) || 30) / 100 + 1e-9;
              return (
                <tr key={r.id} className="border-b border-hairline last:border-0">
                  <td className="px-2 py-2">
                    <input type="checkbox" disabled={!diff} checked={picked.has(r.id) && diff}
                      onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-bold">{r.brand}</div>
                    <div className="text-[10px] text-ink-soft">{r.bottleSize}・{r.cups}杯取り{r.status === "soldout" ? "・売切" : ""}{r.linked ? "" : "・スマレジ未紐づけ"}</div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{yen(r.cost)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{yen(r.perCup)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <div>{yen(r.price)}</div>
                    <div className={`text-[10px] ${isOver ? "font-bold text-[#b3261e]" : "text-ink-soft"}`}>{pct(r.rate)}</div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <div className={diff ? "font-bold text-moss" : "text-ink-soft"}>{yen(r.proposed)}</div>
                    <div className="text-[10px] text-ink-soft">{pct(r.proposedRate)}{diff && r.proposed != null ? `・1合 ¥${(r.proposed * 2).toLocaleString()}` : ""}</div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-ink-soft">{busy ? "読み込み中…" : "銘柄がありません"}</td></tr>}
          </tbody>
        </table>
      </div>

      <label className="mt-3 flex items-start gap-2 text-xs">
        <input type="checkbox" checked={applySettings} onChange={(e) => setApplySettings(e.target.checked)} className="mt-0.5" />
        <span>今後の納品（納品書スキャンの自動計算）にも、この上限と最低売価を使う</span>
      </label>
      <button onClick={apply} disabled={busy || changes.length === 0}
        className="mt-3 w-full rounded-full bg-moss-deep py-3.5 text-sm font-bold text-white disabled:opacity-40">
        {busy ? "処理中…" : changes.length ? `選んだ ${changes.length} 銘柄の売価を変更する（値上げ ${up}・値下げ ${down}）` : "変更する銘柄がありません"}
      </button>
    </section>
  );
}
