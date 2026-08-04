"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type S = { rateNormal: number; ratePremium: number; rateLimited: number; taxRate: number; cups1800: number; cups750: number; minPrice: number; roundUnit: number };

export function SettingsForm() {
  const [s, setS] = useState<S | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [csv, setCsv] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasteMsg, setPasteMsg] = useState("");

  // 貼り付けテキスト → 取り込み行（カンマ/タブ区切り・1行1銘柄）
  // 列順: 銘柄, 仕入単価(税抜), 区分, 容量, 季節ラベル, 隠し酒, 納品日
  function parseCsv(text: string) {
    const rows: { brand: string; cost: number; kubun: string; size: string; season: string; hidden: boolean; delivered: string }[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const c = line.split(/\t|,/).map((x) => x.trim());
      if (!c[0] || c[0] === "銘柄") continue; // 空行・ヘッダーはスキップ
      rows.push({
        brand: c[0],
        cost: Number(String(c[1] ?? "").replace(/[^0-9.]/g, "")) || 0,
        kubun: c[2] || "通常",
        size: c[3] || "1.8L",
        season: c[4] || "",
        hidden: /^(1|隠し|隠し酒|yes|true)$/i.test(c[5] || ""),
        delivered: c[6] || "",
      });
    }
    return rows;
  }

  async function importPaste() {
    const rows = parseCsv(csv);
    if (!rows.length) { setPasteMsg("読み取れる行がありません（1行1銘柄・カンマ/タブ区切り）"); return; }
    if (!confirm(`${rows.length}件を取り込みます。仕入値から売価を自動計算します（重複はスキップ・写真は後付け）。`)) return;
    setPasting(true);
    setPasteMsg("");
    try {
      const res = await fetch("/api/admin/import-sheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const j = await res.json();
      if (!res.ok) setPasteMsg(j.error === "unauthorized" ? "管理者のみ実行できます" : "取込に失敗しました");
      else setPasteMsg(`✓ 新規${j.created}件・スキップ${j.skipped}件（計${j.total}件）`);
    } catch { setPasteMsg("通信に失敗しました"); }
    setPasting(false);
  }

  async function importSheet() {
    if (!confirm("スプレッドシートの現店頭分を一括取込します。\n（写真なし＝お客様画面には出ません・重複はスキップ）")) return;
    setImporting(true);
    setImportMsg("");
    try {
      const res = await fetch("/api/admin/import-sheet", { method: "POST" });
      const j = await res.json();
      if (!res.ok) setImportMsg(j.error === "unauthorized" ? "管理者のみ実行できます" : "取込に失敗しました");
      else setImportMsg(`✓ 新規${j.created}件・スキップ${j.skipped}件（計${j.total}件）`);
    } catch { setImportMsg("通信に失敗しました"); }
    setImporting(false);
  }

  useEffect(() => {
    fetch("/api/admin/settings").then((r) => r.json()).then((j) => setS(j.settings)).catch(() => {});
  }, []);

  function set<K extends keyof S>(k: K, v: number) {
    setS((p) => (p ? { ...p, [k]: v } : p));
  }
  async function save() {
    if (!s) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
      const j = await res.json();
      if (res.ok) { setS(j.settings); setMsg("保存しました"); } else setMsg("保存に失敗しました");
    } catch { setMsg("通信に失敗しました"); }
    setBusy(false);
  }

  if (!s) return <main className="mx-auto max-w-lg px-6 pt-12">読み込み中…</main>;

  const pct = (k: keyof S) => (
    <input type="number" step="0.1" value={Math.round((s[k] as number) * 1000) / 10}
      onChange={(e) => set(k, (Number(e.target.value) || 0) / 100)}
      className="w-24 rounded-lg border border-hairline bg-card px-3 py-2 text-right text-sm outline-none" />
  );
  const num = (k: keyof S) => (
    <input type="number" value={s[k] as number} onChange={(e) => set(k, Number(e.target.value) || 0)}
      className="w-24 rounded-lg border border-hairline bg-card px-3 py-2 text-right text-sm outline-none" />
  );

  const Row = ({ label, unit, children }: { label: string; unit: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between border-b border-hairline py-3 last:border-0">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-1.5">{children}<span className="w-6 text-xs text-ink-soft">{unit}</span></span>
    </div>
  );

  return (
    <main className="mx-auto max-w-lg px-6 pb-24 pt-12">
      <Link href="/admin" className="text-xs text-ink-soft">‹ 在庫ボードへ戻る</Link>
      <h1 className="mt-2 text-2xl font-bold">価格設定</h1>
      <p className="mt-1 text-xs text-ink-soft">納品書スキャン時の売価自動計算に使われます。</p>

      <div className="mt-5 rounded-2xl bg-card px-4 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
        <Row label="通常 目標原価率" unit="%">{pct("rateNormal")}</Row>
        <Row label="プレミア・希少 原価率" unit="%">{pct("ratePremium")}</Row>
        <Row label="期間限定 原価率" unit="%">{pct("rateLimited")}</Row>
        <Row label="消費税率" unit="%">{pct("taxRate")}</Row>
        <Row label="1.8L 1本の提供杯数" unit="杯">{num("cups1800")}</Row>
        <Row label="750ml 1本の提供杯数" unit="杯">{num("cups750")}</Row>
        <Row label="最低売価(税込)" unit="円">{num("minPrice")}</Row>
        <Row label="売価の丸め単位" unit="円">{num("roundUnit")}</Row>
      </div>

      {msg && <p className="mt-3 text-center text-sm text-moss-deep">{msg}</p>}
      <button onClick={save} disabled={busy} className="mt-5 w-full rounded-full bg-moss-deep py-4 text-[15px] font-bold text-white disabled:opacity-50">
        {busy ? "保存中…" : "保存する"}
      </button>

      <div className="mt-8 rounded-2xl border border-dashed border-hairline p-4">
        <p className="text-sm font-bold">現在の在庫を一括取込</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
          スプレッドシートの現店頭分（売切でない最新納品）を、仕入値から売価を自動計算して取り込みます。
          写真が無いためお客様画面には出ません（在庫・原価・データ専用）。重複はスキップ。管理者のみ。
        </p>
        <button onClick={importSheet} disabled={importing} className="mt-3 w-full rounded-full border border-moss bg-card py-3 text-sm font-bold text-moss disabled:opacity-50">
          {importing ? "取込中…" : "スプレッドシートから一括取込"}
        </button>
        {importMsg && <p className="mt-2 text-center text-[12px] text-moss-deep">{importMsg}</p>}
      </div>

      {/* 新しい納品をCSV/表計算から貼り付けて一括取込（容量・区分・隠し酒も行ごとに反映） */}
      <div className="mt-5 rounded-2xl border border-dashed border-hairline p-4">
        <p className="text-sm font-bold">CSVを貼り付けて一括取込（新しい納品）</p>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
          1行1銘柄・<b>カンマかタブ区切り</b>で貼り付け → 仕入値から売価を自動計算して取り込みます。重複（同名）はスキップ。写真は後付け（付くまで客画面には出ません）。
        </p>
        <p className="mt-1 rounded-lg bg-[#f1efe9] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-ink-soft">
          列順：<b>銘柄, 仕入単価, 区分, 容量, 季節ラベル, 隠し酒, 納品日</b><br />
          区分＝<b>通常 / プレミア・希少 / 期間限定</b>（空欄＝通常）・容量＝<b>1.8L / 720ml / 500ml</b>（空欄＝1.8L）・隠し酒＝<b>1</b>で隠し酒
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
          placeholder={"銘柄, 仕入単価, 区分, 容量, 季節ラベル, 隠し酒, 納品日\n鍋島 特別本醸造, 2591, 通常, 1.8L, , , 2026-06-25"}
          className="mt-2 w-full rounded-xl border border-hairline bg-card px-3 py-2 text-[12px] leading-relaxed outline-none"
        />
        <button
          onClick={importPaste}
          disabled={pasting || !csv.trim()}
          className="mt-2 w-full rounded-full bg-moss-deep py-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {pasting ? "取込中…" : `貼り付けた内容を取り込む${csv.trim() ? `（${parseCsv(csv).length}件）` : ""}`}
        </button>
        {pasteMsg && <p className="mt-2 text-center text-[12px] text-moss-deep">{pasteMsg}</p>}
      </div>
    </main>
  );
}
