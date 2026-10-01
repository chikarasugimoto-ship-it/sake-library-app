"use client";

import { useState } from "react";
import { QuickAdd } from "./QuickAdd";
import { addToCart, currentTable, orderingUiEnabled, type CartSake } from "@/lib/cart";
import { T } from "@/components/T";
import { useLang } from "@/lib/lang";
import { Mascot, MascotSpeech } from "@/components/Mascot";

// 上級者向け（味わいで指定）。語彙のない初心者向けには下の MOODS を使う。
// value はAPIへ送る原文（日本語）、en は表示用の英語ラベル。
const CHIPS: { value: string; en: string }[] = [
  { value: "辛口", en: "Dry" },
  { value: "甘口", en: "Sweet" },
  { value: "フルーティ", en: "Fruity" },
  { value: "スッキリ", en: "Crisp" },
  { value: "濃厚", en: "Rich" },
  { value: "旨口", en: "Savory" },
  { value: "華やか", en: "Aromatic" },
  { value: "初心者向け", en: "For beginners" },
  { value: "食事に合わせて", en: "Pairs with food" },
  { value: "ちょっと贅沢に", en: "A little luxe" },
];

// 語彙不要の「気分」選択（タップ→AIへ好みに変換）。初心者が最初の一歩を踏めるように。
const MOODS: { key: string; emoji: string; label: string; labelEn: string; prefs: string[] }[] = [
  { key: "すっきり", emoji: "🌿", label: "軽くスッキリ", labelEn: "Light & crisp", prefs: ["スッキリ", "辛口"] },
  { key: "フルーティ", emoji: "🍑", label: "甘くフルーティ", labelEn: "Sweet & fruity", prefs: ["フルーティ", "甘口"] },
  { key: "旨口", emoji: "🍚", label: "コクのある旨口", labelEn: "Rich & savory", prefs: ["旨口", "濃厚"] },
  { key: "食事", emoji: "🍜", label: "食事に合わせて", labelEn: "To pair with food", prefs: ["食事に合わせて"] },
  { key: "華やか", emoji: "🌸", label: "華やかな香り", labelEn: "Floral aroma", prefs: ["華やか", "フルーティ"] },
  { key: "おまかせ", emoji: "✨", label: "おまかせ", labelEn: "Surprise me", prefs: [] },
];
const BUDGETS: { key: string; label: string; labelEn: string; pref?: string }[] = [
  { key: "お手頃", label: "お手頃に", labelEn: "Easygoing" },
  { key: "ふつう", label: "ふつう", labelEn: "Standard" },
  { key: "贅沢", label: "特別な一杯", labelEn: "Something special", pref: "ちょっと贅沢に" },
];

type Rec = { id: number; brand: string; grade: string; prefecture: string; price: number | null; volume?: string; isPremium?: boolean; reason: string };

// AIソムリエ：好みを伝えると、本日の在庫から合う一本を提案
// open/onOpenChange を渡すと外部から開閉できる（一覧の空状態などから起動するため）。
export function Recommend({ open: openProp, onOpenChange, onDetail }: { open?: boolean; onOpenChange?: (v: boolean) => void; onDetail?: (id: number) => void } = {}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean) => {
    setOpenState(v);
    onOpenChange?.(v);
  };
  const [prefs, setPrefs] = useState<string[]>([]);
  const [mood, setMood] = useState("");
  const [budget, setBudget] = useState("");
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [items, setItems] = useState<Rec[]>([]);
  const lang = useLang();

  function toggle(c: string) {
    setPrefs((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  }
  const canAsk = !!mood || !!text.trim() || prefs.length > 0;

  const canOrder = orderingUiEnabled() && !!currentTable();
  const toCartItem = (r: Rec): CartSake => ({ id: r.id, brand: r.brand, grade: r.grade, price: r.price, volume: r.volume });
  function addAll() {
    // 一括追加は基準のグラス(90ml)で入れる（1合・熱燗は銘柄のサイズ選択から）
    items.forEach((r) => addToCart({ ...toCartItem(r), size: "glass" }));
    setOpen(false); // カートバーを見せる
  }

  async function ask() {
    // 気分・予算・（任意の上級チップ）を好みワードに合成してAIへ
    const moodPrefs = MOODS.find((m) => m.key === mood)?.prefs ?? [];
    const budgetPref = BUDGETS.find((b) => b.key === budget)?.pref;
    const finalPrefs = [...new Set([...moodPrefs, ...(budgetPref ? [budgetPref] : []), ...prefs])];
    setPhase("loading");
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: finalPrefs, text, lang }),
      });
      const j = await res.json();
      if (!res.ok) { setPhase("error"); return; }
      setItems(j.items || []);
      setPhase("done");
    } catch {
      setPhase("error");
    }
  }

  return (
    <>
      {/* スクロールしても右下に常駐する丸い相談FAB（ラベル＋深緑の丸＋相談役すぎだまるの丸アイコン） */}
      <button
        onClick={() => setOpen(true)}
        aria-label="すぎだまるに相談する"
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)_+_96px)] z-40 flex flex-col items-end gap-1.5 active:scale-95"
      >
        <span className="whitespace-nowrap rounded-full bg-moss-deep px-3 py-1 text-[10.5px] font-bold text-white shadow-[0_3px_10px_rgba(0,0,0,0.25)]">
          <T ja="すぎだまるに相談する" en="Ask Sugidamaru" />
        </span>
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-moss-deep shadow-[0_8px_22px_rgba(0,0,0,0.32)] ring-1 ring-[#caa86a]/45">
          <Mascot variant="advisor" size={56} className="rounded-full" fallback={<span className="text-2xl">🍶</span>} />
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-paper px-5 pb-8 pt-5" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-hairline" />
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold"><Mascot variant="advisor" size={40} className="rounded-full" fallback={<span>🍶</span>} /> <T ja="すぎだまるに相談" en="Ask Sugidamaru" /></h2>
              <button onClick={() => setOpen(false)} className="text-sm text-ink-soft"><T ja="閉じる" en="Close" /></button>
            </div>
            <MascotSpeech size={48} className="mb-3.5">
              <T ja="こんにちは、すぎだまるです。気分を選ぶだけでOK。本日の在庫から、あなたに合う一本を選びますよ。" en="Hi, I'm Sugidamaru. Just pick a mood — I'll find your perfect match from today's sake." />
            </MascotSpeech>

            {/* 1. 気分（語彙不要・タップだけ） */}
            <p className="mb-1.5 text-[12px] font-bold"><T ja="いまの気分は？" en="What are you in the mood for?" /></p>
            <div className="grid grid-cols-2 gap-2">
              {MOODS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMood(m.key)}
                  className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-[13px] font-bold transition-colors ${
                    mood === m.key ? "border-moss bg-moss text-white" : "border-hairline bg-card text-ink-soft"
                  }`}
                >
                  <span className="text-lg leading-none">{m.emoji}</span>
                  <T ja={m.label} en={m.labelEn} />
                </button>
              ))}
            </div>

            {/* 2. 予算 */}
            <p className="mb-1.5 mt-4 text-[12px] font-bold"><T ja="予算は？" en="Budget?" /></p>
            <div className="flex gap-2">
              {BUDGETS.map((bd) => (
                <button
                  key={bd.key}
                  onClick={() => setBudget(bd.key)}
                  className={`flex-1 rounded-full border px-2 py-2.5 text-[12px] font-bold transition-colors ${
                    budget === bd.key ? "border-moss bg-moss text-white" : "border-hairline bg-card text-ink-soft"
                  }`}
                >
                  <T ja={bd.label} en={bd.labelEn} />
                </button>
              ))}
            </div>

            {/* 3. ひとこと（任意）＋ 上級者向けの味わい指定 */}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={lang === "en" ? "Optional note — e.g. goes with fish / easy to drink" : "ひとこと（任意）例: 魚に合うもの / 飲みやすいの"}
              className="mt-4 w-full rounded-xl border border-hairline bg-card px-3.5 py-3 text-sm outline-none placeholder:text-[#c3c1ba]"
            />

            <details className="mt-3">
              <summary className="cursor-pointer list-none text-[11px] text-ink-soft"><T ja="＋ くわしく選ぶ（味わいで指定）" en="+ Refine by taste" /></summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {CHIPS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => toggle(c.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      prefs.includes(c.value) ? "border-moss bg-moss text-white" : "border-hairline bg-card text-ink-soft"
                    }`}
                  >
                    <T ja={c.value} en={c.en} />
                  </button>
                ))}
              </div>
            </details>

            <button
              onClick={ask}
              disabled={phase === "loading" || !canAsk}
              className="mt-4 w-full rounded-full bg-moss-deep py-3.5 text-sm font-bold tracking-wider text-white disabled:opacity-50"
            >
              {phase === "loading" ? <T ja="すぎだまるが選んでいます…" en="Sugidamaru is choosing…" /> : <T ja="この内容で探す" en="Find my sake" />}
            </button>

            {phase === "error" && (
              <p className="mt-3 text-center text-xs text-[#b04a3a]"><T ja="うまく探せませんでした。もう一度お試しください。" en="Something went wrong. Please try again." /></p>
            )}

            {phase === "done" && (
              <div className="mt-4 space-y-2.5">
                {items.length === 0 && <p className="py-6 text-center text-sm text-ink-soft"><T ja="該当する一本が見つかりませんでした。" en="No matching sake found." /></p>}
                {canOrder && items.length > 1 && (
                  <button
                    onClick={addAll}
                    className="w-full rounded-full bg-moss py-3 text-sm font-bold text-white active:scale-[0.99]"
                  >
                    <T ja={`この${items.length}本をまとめてカートに追加`} en={`Add all ${items.length} to cart`} />
                  </button>
                )}
                {items.map((r) => (
                  <div key={r.id} className="rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.06)]">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[15px] font-bold">
                        {r.brand}
                        {r.grade && <span className="ml-1 text-xs font-normal text-ink-soft">{r.grade}</span>}
                        {r.isPremium && <span className="ml-1.5 rounded-full bg-gilt-bg px-1.5 py-0.5 text-[9px] font-bold text-gilt">◆</span>}
                      </p>
                      {r.price != null && (
                        <span className="shrink-0 text-xs font-bold text-moss">
                          ¥{r.price.toLocaleString()}
                          {r.volume ? <span className="font-normal text-ink-soft"> / {r.volume}</span> : null}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-[#3c3f44]">{r.reason}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <button type="button" onClick={() => onDetail?.(r.id)} className="text-[11px] font-bold text-moss"><T ja="味わいを見る ›" en="Taste & details ›" /></button>
                      {canOrder && <QuickAdd sake={toCartItem(r)} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
