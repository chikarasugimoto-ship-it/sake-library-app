"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { id: number; code: string; reason: string; owner_kind: string; status: string; issued_at: string; redeemed_at: string; sake_id?: number; sake_brand?: string };

function label(reason: string): string {
  const m = /milestone:(\d+)/.exec(reason);
  return m ? `${m[1]}種達成` : "達成特典";
}

export function RedeemForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  async function load() {
    try {
      const r = await fetch("/api/admin/rewards", { cache: "no-store" });
      if (r.ok) setRows((await r.json()).rewards || []);
    } catch {}
  }
  useEffect(() => {
    load();
  }, []);

  async function redeem() {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg({ ok: true, text: `✓ 引換できました（${c}）。隠し酒を1杯ご提供ください。` });
        setCode("");
        load();
      } else {
        setMsg({ ok: false, text: j?.message || "引換できませんでした" });
      }
    } catch {
      setMsg({ ok: false, text: "通信に失敗しました" });
    }
    setBusy(false);
  }

  const issued = rows.filter((r) => r.status === "issued");

  return (
    <main className="mx-auto max-w-lg pb-28">
      <header className="px-6 pt-12 pb-2">
        <Link href="/admin" className="text-[12px] text-ink-soft">‹ 在庫ボード</Link>
        <p className="mt-3 text-[11px] font-bold tracking-[0.3em] text-ink-soft">REWARD</p>
        <h1 className="mt-1 text-2xl font-bold">隠し酒プレゼント 引換</h1>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          お客様が図鑑で達成した<b className="text-moss-deep">引換コード</b>を入力して消し込みます（20歳以上・1杯90ml・お会計に応じて）。
        </p>
      </header>

      <div className="mx-6 mt-3 rounded-2xl border border-hairline bg-card p-4">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && redeem()}
          placeholder="SK-XXXX-XXXX"
          className="w-full rounded-xl border border-hairline bg-paper px-3.5 py-3 text-center font-mono text-lg tracking-wider outline-none placeholder:text-[#c3c1ba]"
        />
        <button
          onClick={redeem}
          disabled={busy || !code.trim()}
          className="mt-3 w-full rounded-full bg-moss-deep py-3.5 text-sm font-bold tracking-wider text-white disabled:opacity-50"
        >
          {busy ? "確認中…" : "このコードを引換済みにする"}
        </button>
        {msg && (
          <p className={`mt-3 rounded-xl px-3 py-2 text-center text-[12.5px] ${msg.ok ? "bg-[#eef3ef] text-moss-deep" : "bg-[#fbeceb] text-[#b3261e]"}`}>
            {msg.text}
          </p>
        )}
      </div>

      <section className="mt-6">
        <h2 className="px-6 text-[11px] font-bold tracking-[0.14em] text-moss">未引換（{issued.length}）</h2>
        <div className="mt-2 space-y-1.5 px-4">
          {issued.length === 0 && <p className="px-2 py-4 text-center text-[12px] text-ink-soft">未引換のコードはありません。</p>}
          {issued.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl bg-card px-4 py-2.5 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
              <span className="min-w-0 text-[11px] text-ink-soft">
                {label(r.reason)} ・ {r.owner_kind === "member" ? "会員" : "ゲスト"}
                {r.sake_brand ? <span className="ml-1 font-bold text-moss-deep">🍶 {r.sake_brand}</span> : <span className="ml-1 text-[#b08a2a]">（未選択）</span>}
              </span>
              <span className="ml-2 shrink-0 font-mono text-[14px] font-bold tracking-wider text-moss-deep">{r.code}</span>
            </div>
          ))}
        </div>
      </section>

      {rows.some((r) => r.status === "redeemed") && (
        <section className="mt-6">
          <h2 className="px-6 text-[11px] font-bold tracking-[0.14em] text-ink-soft">引換済み</h2>
          <div className="mt-2 space-y-1 px-4">
            {rows.filter((r) => r.status === "redeemed").map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl bg-[#f1efe9] px-4 py-2 opacity-70">
                <span className="text-[11px] text-ink-soft">{label(r.reason)}</span>
                <span className="font-mono text-[12px] text-ink-soft line-through">{r.code}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
