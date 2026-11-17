"use client";

import { useCallback, useEffect, useState } from "react";

// 仕入単価（税抜）の入力（管理者のみ・2026-11-19）。
// 仕入単価が空の銘柄は原価率が出せない。ここで入れると、売価の見直しと飲み放題の自動の枠に反映される。
// 売価は変わらない（変えたいときは下の「売価の見直し」から）。
type Row = { id: number; name: string; price: number | null; status: string; bottleSize: string; cost: number | null };

export function CostPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [vals, setVals] = useState<Record<number, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/sake-costs", { cache: "no-store" });
      if (r.status === 401) { setDenied(true); return; }
      const j = (await r.json()) as { rows?: Row[] };
      setRows(j.rows ?? []);
      setVals({});
    } catch { setErr("読み込めませんでした"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (denied) return null;
  const missing = rows.filter((r) => r.cost == null);
  const list = showAll ? rows : missing;
  const entered = Object.entries(vals).filter(([, v]) => Number(v) >= 100);

  async function save() {
    if (!entered.length || busy) return;
    setBusy(true); setMsg(""); setErr("");
    try {
      const r = await fetch("/api/admin/sake-costs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: entered.map(([id, v]) => ({ id: Number(id), cost: Number(v) })) }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; changed?: unknown[]; message?: string };
      if (!r.ok || !j.ok) setErr(j.message || "保存できませんでした");
      else { setMsg(`${j.changed?.length ?? 0} 銘柄の仕入単価を保存しました`); await load(); }
    } catch { setErr("通信に失敗しました"); }
    setBusy(false);
  }

  return (
    <section className="mx-auto max-w-lg px-6 pb-10">
      <h2 className="text-xl font-bold">仕入単価の入力</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        1 本の仕入単価（税抜）を入れます。空の銘柄は原価率が出せず、飲み放題の自動の枠にも入りません。ここで入れても売価は変わりません。
      </p>
      <p className="mt-2 text-sm">
        仕入単価が未入力: <b>{missing.length}</b> 銘柄
        <label className="ml-3 text-xs text-ink-soft"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> 入力済みも表示して直す</label>
      </p>
      {list.length === 0 && <p className="mt-2 text-sm text-ink-soft">未入力の銘柄はありません。</p>}
      <ul className="mt-3 space-y-1.5 rounded-2xl bg-card p-3 shadow-[0_1px_3px_rgba(38,40,43,0.05)] empty:hidden">
        {list.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {r.name}
              <span className="ml-1 text-xs text-ink-soft">{r.bottleSize}・売価 {r.price != null ? `¥${r.price.toLocaleString()}` : "—"}{r.status === "soldout" ? "・売切" : ""}</span>
            </span>
            <input
              type="number" inputMode="numeric" min={100} placeholder={r.cost != null ? String(r.cost) : "税抜"}
              value={vals[r.id] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [r.id]: e.target.value }))}
              className="w-24 shrink-0 rounded-xl border border-hairline bg-card px-2 py-1.5 text-right text-sm"
            />
          </li>
        ))}
      </ul>
      {err && <p className="mt-2 text-xs text-[#b3261e]">{err}</p>}
      {msg && <p className="mt-2 rounded-xl bg-[#e8f5e9] px-3 py-2 text-xs text-[#1b7a3d]">{msg}</p>}
      <button onClick={save} disabled={busy || entered.length === 0} className="mt-3 w-full rounded-full bg-moss-deep py-3.5 text-sm font-bold text-white disabled:opacity-40">
        {busy ? "保存中…" : `入力した ${entered.length} 銘柄を保存`}
      </button>
    </section>
  );
}
