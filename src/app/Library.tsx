"use client";

import { useMemo, useState } from "react";
import { type Sake, photoUrl } from "@/lib/types";
import { BottleArt } from "@/components/BottleArt";
import { QuickAdd } from "./QuickAdd";
import { Recommend } from "./Recommend";
import { SakeSheet } from "./SakeSheet";
import { T } from "@/components/T";
import { LangToggle } from "@/components/LangToggle";
import { Mascot } from "@/components/Mascot";

// ============================================================================
// 酒コレの客向け画面は、この 1 ページだけ（2026-10-01 オーナー裁定）。
//   残すもの: 本日の日本酒の一覧・味わいチャート（詳細シート）・すぎだまるの相談・注文
//   やめたもの: 図鑑（飲んだ記録）・30種で隠し酒プレゼント・酒神（モンスター）・ランキング・LINEログイン
// 詳細は別ページに飛ばず、カードをタップすると下からシート（SakeSheet）が出る。
// ============================================================================

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
  const [detail, setDetail] = useState<Sake | null>(null);

  const visible = useMemo(() => {
    // 売り切れは「注文」一覧に出さない（頼めないものは並べない）
    const live = sakes.filter((s) => s.status !== "soldout");
    if (filter === "すべて") return live;
    if (filter === "季節限定") return live.filter((s) => s.seasonLabel);
    if (filter === "プレミアム") return live.filter((s) => s.isPremium);
    return live.filter((s) => s.tasteTags.includes(filter));
  }, [sakes, filter]);

  const servingCount = sakes.filter((s) => s.status !== "soldout").length;
  // 店が指定した初心者おすすめ（提供中・最大3本）。語彙の無い初心者が必ず最初の一杯に出会える固定枠。
  const beginners = useMemo(() => sakes.filter((s) => s.isBeginner && s.status !== "soldout").slice(0, 3), [sakes]);
  // 本日のおすすめ＝サーバーで1日1回だけ確定したセット（営業後に翌営業日ぶんへ切替・日中は固定）。
  const recommends = useMemo(() => {
    const byId = new Map(sakes.map((s) => [s.id, s]));
    return recommendIds.map((id) => byId.get(id)).filter((s): s is Sake => !!s && s.status !== "soldout" && s.hasPhoto);
  }, [sakes, recommendIds]);

  // すぎだまるの提案カードの「詳細を見る」→ 同じ画面の詳細シートを開く
  const openDetailById = (id: number) => {
    const s = sakes.find((x) => x.id === id);
    if (!s) return;
    setAiOpen(false);
    setDetail(s);
  };

  return (
    <main className="mx-auto max-w-lg pb-[calc(env(safe-area-inset-bottom)_+_120px)]">
      <header className="relative px-6 pt-10 pb-1">
        <LangToggle className="absolute right-6 top-10" />
        <p className="text-[11px] font-bold tracking-[0.3em] text-moss">酒コレ ・ 煮干しと日本酒 すぎだま</p>
        <h1 className="mt-1.5 text-2xl font-bold">
          <T ja="本日の日本酒" en="Today's Sake" /> <span className="text-moss">{servingCount}</span>
        </h1>
        <p className="mt-1 text-xs text-ink-soft">{today}</p>
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

      <Recommend open={aiOpen} onOpenChange={setAiOpen} onDetail={openDetailById} />

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
              <MiniCard key={s.id} sake={s} tag={{ ja: "やさしい", en: "Easy", bg: "#1f4636" }} priority onOpen={() => setDetail(s)} />
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
            {recommends.map((s) => (
              <MiniCard key={s.id} sake={s} tag={recoTag(s)} onOpen={() => setDetail(s)} />
            ))}
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
          <SakeCard key={s.id} sake={s} index={i} onOpen={() => setDetail(s)} />
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

      <SakeSheet sake={detail} onClose={() => setDetail(null)} />
    </main>
  );
}

// カードのタップ＝詳細シート。<button> にすると中の＋（QuickAdd）と button の入れ子になり React が警告するので
// div role="button" にして Enter/Space でも開けるようにする。
function cardProps(onOpen: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
    },
  };
}

// 横スクロール枠（はじめての方へ／本日のおすすめ）の小カード。タップで詳細シート。
function MiniCard({ sake: s, tag, priority = false, onOpen }: { sake: Sake; tag: { ja: string; en: string; bg: string }; priority?: boolean; onOpen: () => void }) {
  return (
    <div
      {...cardProps(onOpen)}
      className="block w-[138px] shrink-0 cursor-pointer overflow-hidden rounded-2xl bg-card text-left shadow-[0_1px_3px_rgba(38,40,43,0.06)]"
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
          priority={priority}
        />
        <QuickAdd
          sake={{ id: s.id, brand: s.brand, grade: s.grade, price: s.price, volume: s.volume }}
          kanOk={s.kanOk}
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
            ¥{s.price.toLocaleString()} <span className="font-normal text-ink-soft">/ <T ja={`グラス(${s.volume || "90ml"})`} en={`glass (${s.volume || "90ml"})`} /></span>
          </p>
        )}
      </div>
    </div>
  );
}

function SakeCard({ sake: s, index, onOpen }: { sake: Sake; index: number; onOpen: () => void }) {
  return (
    <div
      {...cardProps(onOpen)}
      className={`rise block cursor-pointer overflow-hidden rounded-2xl bg-card text-left shadow-[0_1px_3px_rgba(38,40,43,0.06)] ${
        s.isPremium ? "ring-1 ring-inset ring-gilt-line" : ""
      }`}
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="relative aspect-[4/5] bg-white">
        {s.seasonLabel && s.status === "available" && (
          <span className="absolute left-2.5 top-2.5 z-10 rounded-full border border-[#e4d5b6] bg-white/85 px-2 py-0.5 text-[9px] font-semibold text-[#9a7b40]">
            <T ja={s.seasonLabel} en={s.seasonLabel} />
          </span>
        )}
        <BottleArt
          color={s.labelColor}
          photoUrl={s.hasPhoto ? photoUrl(s.id, s.updatedAt) : null}
          alt={s.brand}
          priority={index < 2}
        />
        <QuickAdd sake={{ id: s.id, brand: s.brand, grade: s.grade, price: s.price, volume: s.volume }} kanOk={s.kanOk} className="absolute bottom-2.5 right-2.5" />
      </div>
      <div className="px-3.5 pb-3.5 pt-3">
        <h2 className="text-[15px] font-bold leading-snug">
          <T ja={s.brand} en={s.en?.brand || s.brand} />
        </h2>
        <p className="mt-0.5 text-[11px] text-ink-soft">
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
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {s.isPremium && (
            <span className="rounded-full bg-gilt-bg px-2 py-0.5 text-[10px] text-gilt">◆ <T ja="プレミアム" en="Premium" /></span>
          )}
          {s.tasteTags.slice(0, 2).map((t, i) => (
            <span key={t} className="rounded-full bg-[#eef3ef] px-2 py-0.5 text-[10px] text-moss">
              <T ja={t} en={s.en?.tasteTags?.[i] ?? t} />
            </span>
          ))}
        </div>
        {s.price != null && (
          <p className={`mt-1.5 text-[11px] font-bold ${s.isPremium ? "text-gilt" : "text-ink"}`}>
            ¥{s.price.toLocaleString()} <span className="font-normal text-ink-soft">/ <T ja={`グラス(${s.volume || "90ml"})`} en={`glass (${s.volume || "90ml"})`} /></span>
          </p>
        )}
        <div className="mt-2.5 flex items-center justify-center gap-1 rounded-full border border-moss/40 bg-[#eef3ef] py-1.5 text-[11px] font-bold text-moss-deep">
          <T ja="味わいを見る" en="Taste & details" /> ›
        </div>
      </div>
    </div>
  );
}
