"use client";

import { useRef, useState } from "react";
import Link from "next/link";

type S = { rateNormal: number; ratePremium: number; rateLimited: number; taxRate: number; cups1800: number; cups750: number; minPrice: number; roundUnit: number };
type Item = {
  brand: string;
  bottle_size: string;
  cost_excl_tax: number | null;
  qty: number;
  kubun: string;
  price: number;
  sakeId: number | null;
  matchedName: string | null;
  confidence: number;
  uncertain: string[];
  include: boolean;
};

const KUBUN = ["通常", "プレミア・希少", "期間限定"];
const FIELD_LABEL: Record<string, string> = { brand: "銘柄", bottle_size: "容量", cost_excl_tax: "仕入単価", qty: "数量" };

function calc(cost: number | null, size: string, kubun: string, s: S): number {
  if (!cost || cost <= 0) return 0;
  const cups = /750/.test(size) ? s.cups750 : s.cups1800;
  const rate = kubun === "プレミア・希少" ? s.ratePremium : kubun === "期間限定" ? s.rateLimited : s.rateNormal;
  const incl = (cost / (cups || 19) / (rate || 0.25)) * (1 + s.taxRate);
  return Math.max(Math.ceil(incl / (s.roundUnit || 100)) * (s.roundUnit || 100), s.minPrice || 0);
}

// Uint8Array → base64（スタック溢れを避けてチャンク処理）
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// 選んだファイルをAPIに渡す形に。PDFはそのまま・画像は長辺1600pxへ（明細の文字を残しつつ軽量化）
async function fileToPayload(file: File): Promise<{ base64: string; media_type: string }> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const buf = await file.arrayBuffer();
    return { base64: bytesToBase64(new Uint8Array(buf)), media_type: "application/pdf" };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.split(",")[1], media_type: "image/jpeg" };
}

export function InvoiceScan() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "confirm" | "saving" | "done">("idle");
  const [items, setItems] = useState<Item[]>([]);
  const [supplier, setSupplier] = useState("");
  const [settings, setSettings] = useState<S | null>(null);
  const [quality, setQuality] = useState<"good" | "fair" | "low">("good");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setPhase("reading");
    try {
      const { base64, media_type } = await fileToPayload(file);
      const maxLen = media_type === "application/pdf" ? 9_000_000 : 4_000_000;
      if (base64.length > maxLen) {
        setError(media_type === "application/pdf" ? "PDFが大きすぎます（約6MBまで）。ページを分けてください。" : "画像が大きすぎます。");
        setPhase("idle");
        return;
      }
      const res = await fetch("/api/admin/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, media_type }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "読み取りに失敗しました"); setPhase("idle"); return; }
      setSupplier(j.supplier || "");
      setSettings(j.settings);
      setQuality(j.quality || "good");
      setNote(j.note || "");
      setItems((j.items || []).map((it: Omit<Item, "include">) => ({ ...it, uncertain: it.uncertain || [], include: true })));
      setPhase("confirm");
    } catch {
      setError("ファイルの処理に失敗しました（対応：写真・PDF）");
      setPhase("idle");
    }
  }

  function update(i: number, patch: Partial<Item>) {
    setItems((arr) => arr.map((it, idx) => {
      if (idx !== i) return it;
      const next = { ...it, ...patch };
      // 手で直したフィールドは「不確実」から外す＝警告が消える
      const edited = Object.keys(patch).filter((k) => k !== "include");
      if (edited.length && next.uncertain?.length) next.uncertain = next.uncertain.filter((f) => !edited.includes(f));
      if (settings) next.price = calc(next.cost_excl_tax, next.bottle_size, next.kubun, settings);
      return next;
    }));
  }

  async function apply() {
    const included = items.filter((it) => it.include);
    // 単価未入力で売価が出ない品目は黙って落とさず、明示的に止めて確認させる
    const missing = included.filter((it) => !it.price || it.price <= 0);
    if (missing.length) {
      setError(`仕入単価が未入力の品目が ${missing.length} 件あります。単価を入れるか、チェックを外してください。`);
      return;
    }
    const targets = included.filter((it) => it.price > 0);
    if (!targets.length) { setError("登録対象がありません（チェックを入れてください）"); return; }
    setError("");
    setPhase("saving");
    try {
      const res = await fetch("/api/admin/invoice/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: targets }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "登録に失敗しました"); setPhase("confirm"); return; }
      setResult(`新規${j.created}件・更新${j.updated}件を反映しました`);
      setPhase("done");
    } catch { setError("通信に失敗しました"); setPhase("confirm"); }
  }

  const warnCount = items.filter((it) => it.include && (it.uncertain?.length ?? 0) > 0).length;

  return (
    <main className="mx-auto max-w-lg px-6 pb-24 pt-12">
      <Link href="/admin" className="text-xs text-ink-soft">‹ 在庫ボードへ戻る</Link>
      <h1 className="mt-2 text-2xl font-bold">納品書スキャン</h1>
      <p className="mt-1 text-xs text-ink-soft">納品書/領収書を撮影、または<b>PDF・画像ファイル</b>から読み込み。AIが銘柄と仕入単価を読み取り、売価を自動計算します。</p>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
      <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={onPick} />

      {error && <p className="mt-3 rounded-xl bg-[#fbeceb] px-3 py-2 text-sm text-[#b3261e]">{error}</p>}

      {phase === "idle" && (
        <div className="mt-5 space-y-3">
          <button onClick={() => cameraRef.current?.click()} className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-3xl bg-gradient-to-br from-[#23262a] to-[#101214] text-white">
            <span className="text-4xl">🧾</span>
            <span className="text-sm font-semibold">納品書を撮影する</span>
            <span className="text-[11px] text-white/50">明細全体が入るように</span>
          </button>
          <button onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-hairline bg-card py-4 text-sm font-bold text-moss-deep">
            📁 ファイル・PDFから選ぶ
          </button>
          <p className="text-center text-[11px] text-ink-soft">写真・PDF・スクリーンショットに対応。PDFは複数ページもOK。</p>
        </div>
      )}

      {phase === "reading" && (
        <p className="mt-8 animate-pulse text-center text-sm text-ink-soft">AIが納品書を読んでいます…<br /><span className="text-[11px]">PDFは少し時間がかかります</span></p>
      )}

      {(phase === "confirm" || phase === "saving") && (
        <>
          {/* 全体の読み取り警告 */}
          {(quality !== "good" || note || warnCount > 0) && (
            <div className="mt-3 rounded-xl border border-[#e3c98a] bg-[#fbf3df] px-3 py-2.5 text-[12px] leading-relaxed text-[#8a6a25]">
              ⚠️ {quality === "low" ? "写真/PDFが読み取りにくい状態です。" : "一部、読み取りが不確実です。"}
              <b>⚠️マークの項目</b>を中心に内容を確認・修正してから登録してください。
              {warnCount > 0 && <>（要確認 {warnCount} 件）</>}
              {note ? <><br />〔AIメモ：{note}〕</> : null}
            </div>
          )}
          {supplier && <p className="mt-3 text-xs text-ink-soft">仕入先：{supplier}</p>}
          <div className="mt-3 space-y-3">
            {items.map((it, i) => {
              const weak = it.include && (it.uncertain?.length ?? 0) > 0;
              return (
              <div key={i} className={`rounded-2xl border p-3.5 ${!it.include ? "border-hairline bg-[#f0efec] opacity-60" : weak ? "border-[#e3c98a] bg-[#fffdf6]" : "border-hairline bg-card"}`}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" checked={it.include} onChange={(e) => update(i, { include: e.target.checked })} className="mt-1 h-5 w-5 accent-[#1e3d2f]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {weak && <span title="読み取りが不確実" className="text-[13px]">⚠️</span>}
                      <input value={it.brand} onChange={(e) => update(i, { brand: e.target.value })} className="w-full bg-transparent text-sm font-bold outline-none" />
                    </div>
                    <p className="text-[10px] text-ink-soft">{it.sakeId ? `既存「${it.matchedName}」を更新` : "新規登録"}</p>
                  </div>
                  <div className="text-right">
                    <div className={`text-base font-extrabold ${it.price > 0 ? "text-moss-deep" : "text-[#b3261e]"}`}>{it.price > 0 ? `¥${it.price.toLocaleString()}` : "売価未定"}</div>
                    <div className="text-[9px] text-ink-soft">自動算出 売価</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-xs">
                  <select value={it.bottle_size} onChange={(e) => update(i, { bottle_size: e.target.value })} className={`rounded-lg border bg-paper px-2 py-1.5 ${it.uncertain?.includes("bottle_size") ? "border-[#d8a93a]" : "border-hairline"}`}>
                    <option>1.8L</option><option>750ml</option>
                  </select>
                  <span className="flex items-center gap-1">仕入
                    <input type="number" value={it.cost_excl_tax ?? ""} onChange={(e) => update(i, { cost_excl_tax: e.target.value ? Number(e.target.value) : null })} placeholder="税抜" className={`w-20 rounded-lg border bg-paper px-2 py-1.5 text-right ${it.uncertain?.includes("cost_excl_tax") ? "border-[#d8a93a]" : "border-hairline"}`} />円
                  </span>
                  <select value={it.kubun} onChange={(e) => update(i, { kubun: e.target.value })} className="rounded-lg border border-hairline bg-paper px-2 py-1.5">
                    {KUBUN.map((k) => <option key={k}>{k}</option>)}
                  </select>
                </div>
                {weak && (
                  <p className="ml-7 mt-2 rounded-lg bg-[#fbf3df] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-[#8a6a25]">
                    AIが自信を持てない項目があります（{it.uncertain.map((f) => FIELD_LABEL[f] || f).join("・")}）。確認・修正してください。
                    {it.cost_excl_tax == null && " 仕入単価が空のままだと登録されません。"}
                  </p>
                )}
              </div>
              );
            })}
            {items.length === 0 && <p className="py-8 text-center text-sm text-ink-soft">日本酒の明細を読み取れませんでした。別の写真かPDFでお試しください。</p>}
          </div>
          <div className="mt-5 flex gap-3">
            <button onClick={() => { setPhase("idle"); setItems([]); setNote(""); setQuality("good"); }} className="rounded-full border border-hairline bg-card px-5 py-4 text-sm text-ink-soft">やり直す</button>
            <button onClick={apply} disabled={phase === "saving"} className="flex-1 rounded-full bg-moss-deep py-4 text-[15px] font-bold text-white disabled:opacity-50">
              {phase === "saving" ? "反映中…" : "この内容で登録/更新"}
            </button>
          </div>
        </>
      )}

      {phase === "done" && (
        <div className="mt-8 text-center">
          <p className="text-base font-bold text-moss-deep">✓ {result}</p>
          <p className="mt-1 text-xs text-ink-soft">売価は自動計算で入りました。</p>
          <div className="mt-5 flex justify-center gap-3">
            <button onClick={() => { setPhase("idle"); setItems([]); setResult(""); setNote(""); setQuality("good"); }} className="rounded-full border border-moss px-5 py-3 text-sm font-bold text-moss">続けてスキャン</button>
            <Link href="/admin" className="rounded-full bg-moss-deep px-5 py-3 text-sm font-bold text-white">在庫ボードへ</Link>
          </div>
        </div>
      )}
    </main>
  );
}
