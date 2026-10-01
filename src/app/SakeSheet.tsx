"use client";

import { useEffect, useState } from "react";
import { type Sake, photoUrl } from "@/lib/types";
import { BottleArt } from "@/components/BottleArt";
import { SizePicker } from "@/components/SizePicker";
import { T } from "@/components/T";
import { useCart, currentTable, orderingUiEnabled } from "@/lib/cart";

// 銘柄の詳細シート（旧 /sake/[id] ページの中身を、一覧の上に重ねるシートにしたもの・2026-10-01）。
// 味わいチャート・特定名称のやさしい説明・ペアリング・紹介文・注文ボタン。酒神や図鑑の要素は無い。

const CHART_LABELS: { key: "sweet" | "acid" | "aroma" | "sharp"; ja: string; en: string }[] = [
  { key: "sweet", ja: "甘み", en: "Sweetness" },
  { key: "acid", ja: "酸味", en: "Acidity" },
  { key: "aroma", ja: "香り", en: "Aroma" },
  { key: "sharp", ja: "キレ", en: "Crispness" },
];

// 初心者向け：特定名称（純米吟醸 等）をやさしく一行で。長いものから先に判定。
const GRADE_HINTS: [string, string, string][] = [
  ["純米大吟醸", "米と米麹だけ・米を半分以上磨いた最高ランク。華やかで上品", "Junmai Daiginjo — only rice & koji, rice polished 50%+. Top grade; gorgeous and refined."],
  ["純米吟醸", "米と米麹だけ・よく磨いた米。香り高くて飲みやすい", "Junmai Ginjo — only rice & koji, well-polished rice. Aromatic and easy to drink."],
  ["特別純米", "米と米麹だけ・特別な造り。米のうまみがしっかり", "Tokubetsu Junmai — only rice & koji, special brew. Solid rice umami."],
  ["大吟醸", "米を半分以上磨いた・華やかでクリアな香り", "Daiginjo — rice polished 50%+. Gorgeous, clear aroma."],
  ["吟醸", "よく磨いた米・香り高くてすっきり", "Ginjo — well-polished rice. Aromatic and crisp."],
  ["純米", "米と米麹だけ・米のうまみが豊か。燗にも合う", "Junmai — only rice & koji. Rich rice umami; great warmed too."],
  ["本醸造", "すっきり辛口寄り・食事に合わせやすい", "Honjozo — crisp, dry-leaning; pairs easily with food."],
];
function gradeHint(grade: string): { ja: string; en: string } {
  for (const [key, ja, en] of GRADE_HINTS) if (grade.includes(key)) return { ja, en };
  return { ja: "", en: "" };
}

export function SakeSheet({ sake: s, onClose }: { sake: Sake | null; onClose: () => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { lines } = useCart();
  // 閉じたらサイズ選択も閉じる（次に別の銘柄を開いたとき残らない）
  useEffect(() => {
    if (!s) setPickerOpen(false);
  }, [s]);
  if (!s) return null;

  const canOrder = orderingUiEnabled() && !!currentTable() && s.status !== "soldout";
  const inCart = lines.filter((l) => l.item.id === s.id).reduce((n, l) => n + l.qty, 0);
  const gh = gradeHint(s.grade);
  const prefBrewJa = [s.prefecture, s.brewery].filter(Boolean).join(" ・ ");
  const prefBrewEn = [s.en?.prefecture || s.prefecture, s.en?.brewery || s.brewery].filter(Boolean).join(" · ");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-paper pb-[calc(env(safe-area-inset-bottom)_+_24px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between bg-paper/95 px-5 pt-3 pb-1 backdrop-blur">
          <div className="mx-auto h-1 w-10 rounded-full bg-hairline" />
          <button onClick={onClose} className="absolute right-5 top-3 text-sm text-ink-soft" aria-label="閉じる">
            <T ja="閉じる" en="Close" />
          </button>
        </div>

        <div className="relative flex h-60 items-center justify-center" style={{ background: "linear-gradient(170deg, #ffffff, #f3f2ee)" }}>
          <div className="h-52 w-44 overflow-hidden">
            <BottleArt color={s.labelColor} photoUrl={s.hasPhoto ? photoUrl(s.id, s.updatedAt) : null} alt={s.brand} size="lg" priority />
          </div>
        </div>

        <div className="px-6 pt-5">
          <p className="text-xs font-bold tracking-[0.12em] text-moss">
            <T ja={prefBrewJa} en={prefBrewEn} />
          </p>
          <h2 className="mt-1 text-[24px] font-extrabold leading-snug">
            <T ja={s.brand} en={s.en?.brand || s.brand} />
            {s.grade && <span className="ml-2 text-base font-semibold text-ink-soft"><T ja={s.grade} en={s.en?.grade || s.grade} /></span>}
          </h2>
          {s.subName && <p className="mt-1 text-sm text-ink-soft"><T ja={s.subName} en={s.en?.subName || s.subName} /></p>}
          {s.grade && gh.ja && (
            <p className="mt-2 inline-block rounded-lg bg-[#eef3ef] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-moss-deep">
              <T ja={<><b>{s.grade}</b>とは：{gh.ja}</>} en={gh.en} />
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-baseline gap-2">
            {s.price != null && (
              <p className="text-xl font-bold">
                ¥{s.price.toLocaleString()} <span className="text-xs font-normal text-ink-soft">/ <T ja={`グラス(${s.volume || "90ml"})`} en={`glass (${s.volume || "90ml"})`} /></span>
              </p>
            )}
            {s.isPremium && (
              <span className="rounded-full bg-gilt-bg px-2.5 py-1 text-[11px] font-semibold text-gilt"><T ja="◆ プレミアム" en="◆ Premium" /></span>
            )}
            {s.seasonLabel && (
              <span className="rounded-full border border-[#e4d5b6] bg-white px-2.5 py-1 text-[11px] text-[#9a7b40]">{s.seasonLabel}</span>
            )}
            {s.status === "soldout" && (
              <span className="rounded-full bg-[#eceae5] px-2.5 py-1 text-[11px] font-bold text-[#80868c]"><T ja="売切" en="Sold out" /></span>
            )}
          </div>

          {canOrder && (
            <button
              onClick={() => setPickerOpen(true)}
              className="mt-4 w-full rounded-full bg-moss-deep py-4 text-[15px] font-bold tracking-wider text-white active:scale-[0.99]"
            >
              {inCart === 0 ? (
                <>🍶 <T ja="この日本酒を注文に追加" en="Add this sake to your order" /></>
              ) : (
                <>🍶 <T ja={`カートに ${inCart}つ ・ サイズを選んで追加`} en={`${inCart} in cart · choose a size`} /></>
              )}
            </button>
          )}

          <section className="mt-7">
            <h3 className="text-[11px] font-bold tracking-[0.16em] text-ink-soft">
              <T ja="味わいチャート" en="Taste chart" /> <span className="font-normal normal-case tracking-normal text-[#b6b4ae]"><T ja="・5段階の目安（バーが長いほど強め）" en="· 5-point guide (longer = stronger)" /></span>
            </h3>
            <div className="mt-3 space-y-2.5">
              {CHART_LABELS.map(({ key, ja, en }) => (
                <div key={key} className="flex items-center gap-3 text-xs">
                  <span className="w-12 text-ink-soft"><T ja={ja} en={en} /></span>
                  <div className="h-[5px] flex-1 rounded-full bg-[#ecebe7]">
                    <div className="h-full rounded-full bg-moss transition-[width] duration-700" style={{ width: `${(s.tasteChart[key] / 5) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {s.pairings.length > 0 && (
            <section className="mt-7">
              <h3 className="text-[11px] font-bold tracking-[0.16em] text-ink-soft"><T ja="ペアリング" en="Pairings" /></h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {s.pairings.map((p, i) => (
                  <span key={p} className="rounded-full border border-hairline bg-card px-3.5 py-2 text-xs">
                    <b className="text-moss">◎</b> <T ja={p} en={s.en?.pairings?.[i] ?? p} />
                  </span>
                ))}
              </div>
            </section>
          )}

          {s.description && (
            <section className="mt-7">
              <h3 className="text-[11px] font-bold tracking-[0.16em] text-ink-soft"><T ja="この一本について" en="About this sake" /></h3>
              <p className="mt-3 text-[13.5px] leading-[1.9] text-[#3c3f44]"><T ja={s.description} en={s.en?.description || s.description} /></p>
            </section>
          )}

          <div className="mt-7 flex flex-wrap gap-1.5">
            {s.tasteTags.map((t, i) => (
              <span key={t} className="rounded-full bg-[#eef3ef] px-2.5 py-1 text-[11px] text-moss">
                <T ja={t} en={s.en?.tasteTags?.[i] ?? t} />
              </span>
            ))}
          </div>
        </div>
      </div>
      <SizePicker
        sake={{ id: s.id, brand: s.brand, grade: s.grade, price: s.price, volume: s.volume }}
        kanOk={s.kanOk}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
