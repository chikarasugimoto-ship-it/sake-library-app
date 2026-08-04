"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { type Sake, photoUrl } from "@/lib/types";
import { BottleArt } from "@/components/BottleArt";
import { useCollection } from "@/lib/collection";
import { QuickAdd } from "./QuickAdd";
import { Recommend } from "./Recommend";
import { T } from "@/components/T";
import { LangToggle } from "@/components/LangToggle";
import { Mascot } from "@/components/Mascot";

const FILTERS = [
  "すべて",
  "初心者向け",
  "辛口",
  "甘口",
  "フルーティ",
  "濃厚",
  "スッキリ",
  "季節限定",
  "プレミアム",
] as const;

const FILTER_EN: Record<(typeof FILTERS)[number], string> = {
  すべて: "All",
  初心者向け: "For beginners",
  辛口: "Dry",
  甘口: "Sweet",
  フルーティ: "Fruity",
  濃厚: "Rich",
  スッキリ: "Crisp",
  季節限定: "Seasonal",
  プレミアム: "Premium",
};

// 「本日のおすすめ」カードの小さな分類バッジ（なぜおすすめか・緊急感は出さない）。
function recoTag(s: Sake): { ja: string; en: string; bg: string } {
  if (s.freshSensitive) return { ja: "生酒", en: "Nama", bg: "#2f7d8c" };
  if (s.seasonLabel) return { ja: s.seasonLabel, en: s.seasonLabel, bg: "#9a7b40" };
  if (s.isPremium) return { ja: "プレミアム", en: "Premium", bg: "#b8923f" };
  if (s.isBeginner) return { ja: "やさしい", en: "Easy", bg: "#3f7d4f" };
  return { ja: "おすすめ", en: "Pick", bg: "#1f4636" };
}

export function Library({ sakes, today, recommendIds }: { sakes: Sake[]; today: string; recommendIds: number[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("すべて");
  const [aiOpen, setAiOpen] = useState(false);
  const { tasted } = useCollection();

  const visible = useMemo(() => {
    // 売り切れは「注文」一覧に出さない（頼めないものは並べない）
    const live = sakes.filter((s) => s.status !== "soldout");
    if (filter === "すべて") return live;
    if (filter === "季節限定") return live.filter((s) => s.seasonLabel);
    if (filter === "プレミアム") return live.filter((s) => s.isPremium);
    return live.filter((s) => s.tasteTags.includes(filter));
  }, [sakes, filter]);

  const hasSecret = sakes.some((s) => s.isHidden && s.status !== "soldout");
  const servingCount = sakes.filter((s) => s.status !== "soldout").length;
  // 店が指定した初心者おすすめ（提供中・最大3本）。語彙の無い初心者が必ず最初の一杯に出会える固定枠。
  const beginners = useMemo(
    () => sakes.filter((s) => s.isBeginner && s.status !== "soldout" && !s.isHidden).slice(0, 3),
    [sakes]
  );
  // 本日のおすすめ＝サーバーで1日1回だけ確定したセット（営業後に翌営業日ぶんへ切替・日中は固定）。
  // 生酒に偏らないようバランス選定済み。ここでは確定IDの順番を保ったまま、念のため提供中のものだけ描く。
  const recommends = useMemo(() => {
    const byId = new Map(sakes.map((s) => [s.id, s]));
    return recommendIds
      .map((id) => byId.get(id))
      .filter((s): s is Sake => !!s && s.status !== "soldout" && !s.isHidden && s.hasPhoto);
  }, [sakes, recommendIds]);

  return (
    <main className="mx-auto max-w-lg pb-[calc(env(safe-area-inset-bottom)_+_150px)]">
      <header className="relative px-6 pt-10 pb-1">
        <LangToggle className="absolute right-6 top-10" />
        <p className="text-[11px] font-bold tracking-[0.3em] text-moss">酒コレ ・ 酒神コレクション</p>
        <h1 className="mt-1.5 text-2xl font-bold">
          <T ja="本日の日本酒" en="Today's Sake" /> <span className="text-moss">{servingCount}</span>
        </h1>
        <p className="mt-1 text-xs text-ink-soft">
          {today}
          {hasSecret && <T ja=" ・ 隠し酒 あり" en=" · Secret pour available" />}
        </p>
      </header>

      {/* お食事メニュー(モバイルオーダー)へ戻る導線。日本酒＝ここ(酒コレ)、料理・ドリンク＝MO。
          別タブで開く（MOのカゴ・この画面を両方残す）。MOはお客様の来店Cookieでその卓のメニューへ。 */}
      <a
        href="https://sugidama-mo.vercel.app/s/sugidama/menu"
        target="_blank"
        rel="noopener noreferrer"
        className="mx-6 mt-3 flex items-center justify-between gap-2 rounded-2xl bg-card px-4 py-3 shadow-[0_1px_3px_rgba(38,40,43,0.06)] transition active:scale-[0.99]"
      >
        <span className="flex items-center gap-2 text-[13px] font-bold text-ink">
          <span className="text-moss" aria-hidden>←</span>
          <T ja="お食事メニュー（料理・ドリンク）へ" en="Back to food & drinks" />
        </span>
        <span className="shrink-0 text-[11px] text-ink-soft"><T ja="別画面で開く" en="new tab" /></span>
      </a>

      <Recommend open={aiOpen} onOpenChange={setAiOpen} />

      {beginners.length > 0 && (
        <section className="mt-3">
          <div className="flex items-baseline justify-between px-6">
            <h2 className="text-[13.5px] font-bold">
              <T ja="日本酒が" en="" /><span className="text-moss"><T ja="はじめて" en="New to sake?" /></span><T ja="の方へ" en="" />
            </h2>
            <span className="text-[10px] text-ink-soft"><T ja="迷ったらこの一杯から" en="Start with one of these" /></span>
          </div>
          <div className="scrollbar-none flex gap-3 overflow-x-auto px-6 pb-1 pt-2.5">
            {beginners.map((s) => (
              <Link
                key={s.id}
                href={`/sake/${s.id}`}
                className="block w-[138px] shrink-0 overflow-hidden rounded-2xl bg-card shadow-[0_1px_3px_rgba(38,40,43,0.06)]"
              >
                <div className="relative aspect-[4/5] bg-white">
                  <span className="absolute left-2 top-2 z-10 rounded-full bg-moss px-2 py-0.5 text-[9px] font-bold text-white">
                    <T ja="やさしい" en="Easy" />
                  </span>
                  <BottleArt
                    color={s.labelColor}
                    photoUrl={s.hasPhoto ? photoUrl(s.id, s.updatedAt) : null}
                    alt={s.brand}
                    sizes="138px"
                    priority
                  />
                  <QuickAdd
                    sake={{ id: s.id, brand: s.brand, grade: s.grade, price: s.price, volume: s.volume }}
                    className="absolute bottom-2 right-2"
                  />
                </div>
                <div className="px-3 pb-3 pt-2">
                  <p className="truncate text-[13px] font-bold"><T ja={s.brand} en={s.en?.brand || s.brand} /></p>
                  <p className="truncate text-[10px] text-ink-soft">
                    <T
                      ja={[s.brewery, s.prefecture].filter(Boolean).join("・")}
                      en={[s.en?.brewery || s.brewery, s.en?.prefecture || s.prefecture].filter(Boolean).join(" · ")}
                    />
                  </p>
                  {s.price != null && (
                    <p className="mt-1 text-[11px] font-bold text-ink">
                      ¥{s.price.toLocaleString()} <span className="font-normal text-ink-soft">/ {s.volume}</span>
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {recommends.length > 0 && (
        <section className="mt-4">
          <div className="flex items-baseline justify-between px-6">
            <h2 className="text-[13.5px] font-bold">
              🍶 <span className="text-moss-deep"><T ja="本日のおすすめ" en="Today's picks" /></span>
            </h2>
            <span className="text-[10px] text-ink-soft"><T ja="今日の一杯に迷ったら" en="If you're not sure what to try" /></span>
          </div>
          <div className="scrollbar-none flex gap-3 overflow-x-auto px-6 pb-1 pt-2.5">
            {recommends.map((s) => {
              const tag = recoTag(s);
              return (
              <Link
                key={s.id}
                href={`/sake/${s.id}`}
                className="block w-[138px] shrink-0 overflow-hidden rounded-2xl bg-card shadow-[0_1px_3px_rgba(38,40,43,0.06)]"
              >
                <div className="relative aspect-[4/5] bg-white">
                  <span className="absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-[9px] font-bold text-white" style={{ background: tag.bg }}>
                    <T ja={tag.ja} en={tag.en} />
                  </span>
                  <BottleArt
                    color={s.labelColor}
                    photoUrl={s.hasPhoto ? photoUrl(s.id, s.updatedAt) : null}
                    alt={s.brand}
                    sizes="138px"
                  />
                  <QuickAdd
                    sake={{ id: s.id, brand: s.brand, grade: s.grade, price: s.price, volume: s.volume }}
                    className="absolute bottom-2 right-2"
                  />
                </div>
                <div className="px-3 pb-3 pt-2">
                  <p className="truncate text-[13px] font-bold"><T ja={s.brand} en={s.en?.brand || s.brand} /></p>
                  <p className="truncate text-[10px] text-ink-soft">
                    <T
                      ja={[s.brewery, s.prefecture].filter(Boolean).join("・")}
                      en={[s.en?.brewery || s.brewery, s.en?.prefecture || s.prefecture].filter(Boolean).join(" · ")}
                    />
                  </p>
                  {s.price != null && (
                    <p className="mt-1 text-[11px] font-bold text-ink">
                      ¥{s.price.toLocaleString()} <span className="font-normal text-ink-soft">/ {s.volume}</span>
                    </p>
                  )}
                </div>
              </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="scrollbar-none flex gap-2 overflow-x-auto px-6 py-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
              filter === f
                ? "border-moss bg-moss text-white"
                : "border-hairline bg-card text-ink-soft"
            }`}
          >
            <T ja={f} en={FILTER_EN[f]} />
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3.5 px-5 pt-2">
        {visible.map((s, i) => (
          <SakeCard key={s.id} sake={s} index={i} tasted={tasted.has(s.id)} />
        ))}
      </div>

      {visible.length === 0 && (
        <div className="px-6 py-14 text-center">
          <Mascot size={80} className="mx-auto mb-1" />
          <p className="mt-2 text-sm font-bold"><T ja="この条件の日本酒は今日はありません" en="No sake matches this filter today" /></p>
          <p className="mt-1 text-xs text-ink-soft"><T ja="条件をゆるめるか、すぎだまるに相談して選んでもらえます。" en="Try loosening the filter, or let Sugidamaru pick one for you." /></p>
          <div className="mt-4 flex flex-wrap justify-center gap-2.5">
            <button
              onClick={() => setFilter("すべて")}
              className="rounded-full bg-moss-deep px-4 py-2.5 text-[13px] font-bold text-white"
            >
              <T ja="すべての日本酒を見る" en="View all sake" />
            </button>
            <button
              onClick={() => setAiOpen(true)}
              className="rounded-full border border-moss bg-card px-4 py-2.5 text-[13px] font-bold text-moss-deep"
            >
              <Mascot variant="advisor" size={30} className="inline-block rounded-full align-middle" fallback={<span>🍶</span>} /> <T ja="すぎだまるに相談する" en="Ask Sugidamaru" />
            </button>
          </div>
        </div>
      )}

      <footer className="mt-10 px-6 text-center text-[10px] text-ink-soft">
        <p className="leading-relaxed">
          <T ja="20歳未満の飲酒は法律で禁止されています。お酒は適量を、楽しく。" en="Underage drinking is prohibited by law. Please drink responsibly." />
        </p>
        <div className="mt-2 flex justify-center gap-4">
          <a href="/privacy" className="underline"><T ja="プライバシーポリシー" en="Privacy Policy" /></a>
          <a href="/terms" className="underline"><T ja="利用規約" en="Terms of Use" /></a>
        </div>
      </footer>
    </main>
  );
}

function SakeCard({ sake: s, index, tasted }: { sake: Sake; index: number; tasted: boolean }) {
  const soldout = s.status === "soldout";
  const card = (
    <article
      className={`rise overflow-hidden rounded-2xl bg-card shadow-[0_1px_3px_rgba(38,40,43,0.06)] ${
        s.isPremium ? "ring-1 ring-inset ring-gilt-line" : ""
      } ${soldout ? "opacity-45 grayscale" : ""}`}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div
        className="relative aspect-[4/5]"
        style={{ background: s.isHidden ? "#0f241b" : "#ffffff" }}
      >
        {soldout && (
          <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-[#9aa0a6] px-2 py-1 text-[10px] font-bold text-white">
            <T ja="売切" en="Sold out" />
          </span>
        )}
        {s.isHidden && !soldout && (
          <span className="absolute left-2.5 top-2.5 z-10 rounded-full bg-moss-deep px-2 py-1 text-[10px] font-bold text-white">
            <T ja="本日の隠し酒" en="Today's secret pour" />
          </span>
        )}
        {!s.isHidden && s.seasonLabel && s.status === "available" && (
          <span className="absolute left-2.5 top-2.5 z-10 rounded-full border border-[#e4d5b6] bg-white/85 px-2 py-0.5 text-[9px] font-semibold text-[#9a7b40]">
            <T ja={s.seasonLabel} en={s.seasonLabel} />
          </span>
        )}
        {tasted && !s.isHidden && (
          <span className="absolute right-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-moss text-[12px] font-bold text-white shadow-sm">
            ✓
          </span>
        )}
        <BottleArt
          color={s.isHidden ? "#314538" : s.labelColor}
          photoUrl={s.hasPhoto && !s.isHidden ? photoUrl(s.id, s.updatedAt) : null}
          alt={s.brand}
          priority={index < 2}
        />
        {!s.isHidden && !soldout && (
          <QuickAdd sake={{ id: s.id, brand: s.brand, grade: s.grade, price: s.price, volume: s.volume }} className="absolute bottom-2.5 right-2.5" />
        )}
      </div>
      <div className="px-3.5 pb-3.5 pt-3">
        <h2 className="text-[15px] font-bold leading-snug">
          {s.isHidden ? "？？？" : <T ja={s.brand} en={s.en?.brand || s.brand} />}
        </h2>
        <p className="mt-0.5 text-[11px] text-ink-soft">
          {s.isHidden ? (
            <T ja="店内で聞いてみてください" en="Ask our staff in store" />
          ) : (
            <>
              <T
                ja={[s.brewery, s.prefecture].filter(Boolean).join("・")}
                en={[s.en?.brewery || s.brewery, s.en?.prefecture || s.prefecture].filter(Boolean).join(" · ")}
              />
              {s.grade ? (
                <>
                  {" / "}
                  <T ja={s.grade} en={s.en?.grade || s.grade} />
                </>
              ) : null}
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {s.isPremium && (
            <span className="rounded-full bg-gilt-bg px-2 py-0.5 text-[10px] text-gilt">◆ <T ja="プレミアム" en="Premium" /></span>
          )}
          {s.isHidden ? (
            <span className="rounded-full bg-[#eef3ef] px-2 py-0.5 text-[10px] text-moss">
              <T ja="アプリ限定" en="App exclusive" />
            </span>
          ) : (
            s.tasteTags.slice(0, 2).map((t, i) => (
              <span key={t} className="rounded-full bg-[#eef3ef] px-2 py-0.5 text-[10px] text-moss">
                <T ja={t} en={s.en?.tasteTags?.[i] ?? t} />
              </span>
            ))
          )}
        </div>
        {!s.isHidden && s.price != null && (
          <p className={`mt-1.5 text-[11px] font-bold ${s.isPremium ? "text-gilt" : "text-ink"}`}>
            ¥{s.price.toLocaleString()} <span className="font-normal text-ink-soft">/ {s.volume}</span>
          </p>
        )}
        {!s.isHidden && !soldout && (
          <div className="mt-2.5 flex items-center justify-center gap-1 rounded-full border border-moss/40 bg-[#eef3ef] py-1.5 text-[11px] font-bold text-moss-deep">
            📖 <T ja="詳細・酒神を見る" en="Details & god" /> ›
          </div>
        )}
      </div>
    </article>
  );
  if (s.isHidden || soldout) return card;
  return (
    <Link href={`/sake/${s.id}`} className="block">
      {card}
    </Link>
  );
}
