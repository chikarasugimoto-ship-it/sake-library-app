import Link from "next/link";
import { notFound } from "next/navigation";
import { get, all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake, photoUrl } from "@/lib/types";
import { RARITY_META, type Rarity } from "@/lib/sakegami";
import { BottleArt } from "@/components/BottleArt";
import { SakegamiArt } from "@/components/SakegamiArt";
import { T } from "@/components/T";
import { LangToggle } from "@/components/LangToggle";
import { CollectionButtons } from "./CollectionButtons";
import { OrderButton } from "./OrderButton";

// 全銘柄を事前生成＋ISRでキャッシュ＝一覧から詳細へのタップが即時。
// 在庫変更時は admin API の revalidatePath(`/sake/${id}`) で即更新。
export const revalidate = 30;

export async function generateStaticParams() {
  try {
    const rows = await all<{ id: number }>("SELECT id FROM sakes WHERE archived = 0 AND is_hidden = 0");
    return rows.map((r) => ({ id: String(r.id) }));
  } catch {
    return [];
  }
}

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

export default async function SakeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 集めた銘柄は提供終了（archived）/隠し酒でも図鑑から詳細を見られるようにする（IDを知っている＝集めた人）。
  const row = await get<SakeRow & { archived: number }>(
    `SELECT ${SAKE_COLUMNS}, archived FROM sakes WHERE id = ?`,
    [Number(id)]
  );
  if (!row) notFound();
  const s = toSake(row);
  const discontinued = row.archived === 1; // 在庫から消去（提供終了）
  const orderable = !discontinued && s.status !== "soldout";
  const totalRow = await get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sakes WHERE archived = 0 AND is_hidden = 0"
  );
  const total = Number(totalRow?.n ?? 0);
  // 酒神メタ（一括生成済みのときだけ表示）。未生成なら何も出さない。
  const god = await get<{ name: string; rarity: string; kuchijo: string; kuchijo_en: string; region8: string; has_art: number; god_updated: string }>(
    "SELECT name, rarity, kuchijo, kuchijo_en, region8, (god_art IS NOT NULL) AS has_art, updated_at AS god_updated FROM gods WHERE sake_id = ?",
    [Number(id)]
  );
  const godMeta = god && (god.name || god.rarity) ? RARITY_META[(god.rarity as Rarity)] ?? RARITY_META.N : null;
  const godArtUrl = god?.has_art ? `/api/god-art/${id}?v=${(god.god_updated || "").replace(/\D/g, "").slice(0, 14) || "0"}` : null;

  const prefBrewJa = [s.prefecture, s.brewery].filter(Boolean).join(" ・ ");
  const prefBrewEn = [s.en?.prefecture || s.prefecture, s.en?.brewery || s.brewery].filter(Boolean).join(" · ");
  const gh = gradeHint(s.grade);
  const godName = god?.name || "酒神";

  return (
    <main className="mx-auto max-w-lg pb-28">
      <div
        className="relative flex h-80 items-center justify-center"
        style={{ background: "linear-gradient(170deg, #ffffff, #f3f2ee)" }}
      >
        <Link
          href="/"
          className="absolute left-5 top-12 flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-lg text-ink"
          aria-label="一覧へ戻る"
        >
          ‹
        </Link>
        <LangToggle className="absolute right-5 top-12" />
        <div className="h-64 w-52 overflow-hidden">
          <BottleArt color={s.labelColor} photoUrl={s.hasPhoto ? photoUrl(s.id, s.updatedAt) : null} alt={s.brand} size="lg" priority />
        </div>
      </div>

      <div className="rise px-6 pt-6">
        <p className="text-xs font-bold tracking-[0.12em] text-moss">
          <T ja={prefBrewJa} en={prefBrewEn} />
        </p>
        <h1 className="mt-1 text-[27px] font-extrabold leading-snug">
          <T ja={s.brand} en={s.en?.brand || s.brand} />
          {s.grade && <span className="ml-2 text-base font-semibold text-ink-soft"><T ja={s.grade} en={s.en?.grade || s.grade} /></span>}
        </h1>
        {s.subName && <p className="mt-1 text-sm text-ink-soft"><T ja={s.subName} en={s.en?.subName || s.subName} /></p>}
        {s.grade && gh.ja && (
          <p className="mt-2 inline-block rounded-lg bg-[#eef3ef] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-moss-deep">
            <T ja={<><b>{s.grade}</b>とは：{gh.ja}</>} en={gh.en} />
          </p>
        )}
        <div className="mt-3 flex items-baseline gap-2">
          {s.price != null && (
            <p className="text-xl font-bold">
              ¥{s.price.toLocaleString()} <span className="text-xs font-normal text-ink-soft">/ <T ja={`グラス(${s.volume || "90ml"})`} en={`glass (${s.volume || "90ml"})`} /></span>
            </p>
          )}
          {s.isPremium && (
            <span className="rounded-full bg-gilt-bg px-2.5 py-1 text-[11px] font-semibold text-gilt"><T ja="◆ プレミアム" en="◆ Premium" /></span>
          )}
          {s.seasonLabel && (
            <span className="rounded-full border border-[#e4d5b6] bg-white px-2.5 py-1 text-[11px] text-[#9a7b40]">
              {s.seasonLabel}
            </span>
          )}
          {discontinued && (
            <span className="rounded-full bg-[#eceae5] px-2.5 py-1 text-[11px] font-bold text-[#80868c]"><T ja="提供終了" en="Discontinued" /></span>
          )}
        </div>

        {god && godMeta && (
          <div className="mt-5 flex flex-col items-center overflow-hidden rounded-2xl px-4 pb-4 pt-5" style={{ background: "#0c241b" }}>
            <SakegamiArt
              rarity={god.rarity}
              color={s.labelColor}
              photoUrl={s.hasPhoto ? photoUrl(s.id, s.updatedAt) : null}
              artUrl={godArtUrl}
              size={216}
            />
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-md px-2 py-0.5 text-[11px] font-extrabold text-white" style={{ background: godMeta.color }}>
                {god.rarity}・{godMeta.jp}
              </span>
              <span className="text-[17px] font-bold" style={{ color: "#f0dca0" }}>{god.name || "酒神"}</span>
            </div>
            {god.kuchijo && <p className="mt-2 text-center text-[12.5px] leading-relaxed text-[#d7cfbd]"><T ja={god.kuchijo} en={god.kuchijo_en || god.kuchijo} /></p>}
            <p className="mt-2 text-[10px] text-[#9fb1a3]">
              <T
                ja={<>この一杯を注文すると「{godName}」を獲得{god.region8 ? ` ・ ${god.region8}` : ""}</>}
                en={<>Order this sake to collect &ldquo;{godName}&rdquo;{god.region8 ? ` · ${god.region8}` : ""}</>}
              />
            </p>
            <p className="mt-2 border-t border-white/10 pt-2 text-center text-[9.5px] leading-relaxed text-[#7c8c81]">
              <T
                ja="※ このキャラクターはAIが生成したオリジナルで、酒蔵とは一切関係がありません。"
                en="* This character is an original AI creation and has no affiliation with the brewery."
              />
            </p>
          </div>
        )}

        {orderable && <OrderButton sake={{ id: s.id, brand: s.brand, grade: s.grade, price: s.price, volume: s.volume }} kanOk={s.kanOk} />}
        <CollectionButtons id={s.id} total={total} />

        <section className="mt-8">
          <h2 className="text-[11px] font-bold tracking-[0.16em] text-ink-soft">
            <T ja="味わいチャート" en="Taste chart" /> <span className="font-normal normal-case tracking-normal text-[#b6b4ae]"><T ja="・5段階の目安（バーが長いほど強め）" en="· 5-point guide (longer = stronger)" /></span>
          </h2>
          <div className="mt-3 space-y-2.5">
            {CHART_LABELS.map(({ key, ja, en }) => (
              <div key={key} className="flex items-center gap-3 text-xs">
                <span className="w-12 text-ink-soft"><T ja={ja} en={en} /></span>
                <div className="h-[5px] flex-1 rounded-full bg-[#ecebe7]">
                  <div
                    className="h-full rounded-full bg-moss transition-[width] duration-700"
                    style={{ width: `${(s.tasteChart[key] / 5) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {s.pairings.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[11px] font-bold tracking-[0.16em] text-ink-soft"><T ja="ペアリング" en="Pairings" /></h2>
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
          <section className="mt-8">
            <h2 className="text-[11px] font-bold tracking-[0.16em] text-ink-soft"><T ja="この一本について" en="About this sake" /></h2>
            <p className="mt-3 text-[13.5px] leading-[1.9] text-[#3c3f44]"><T ja={s.description} en={s.en?.description || s.description} /></p>
          </section>
        )}

        <div className="mt-9 flex flex-wrap gap-1.5">
          {s.tasteTags.map((t, i) => (
            <span key={t} className="rounded-full bg-[#eef3ef] px-2.5 py-1 text-[11px] text-moss">
              <T ja={t} en={s.en?.tasteTags?.[i] ?? t} />
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}
