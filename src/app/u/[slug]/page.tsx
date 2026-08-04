import Link from "next/link";
import { notFound } from "next/navigation";
import { get, all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake, photoUrl } from "@/lib/types";
import { rankFor, nextRank } from "@/lib/collection";
import { T } from "@/components/T";

export const revalidate = 60; // 共有プロフィールはISRでキャッシュ＝表示が速い

const SITE = "https://sake-library-plum.vercel.app";

export default async function PublicProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = await get<{ line_user_id: string; display_name: string; picture_url: string }>(
    "SELECT line_user_id, display_name, picture_url FROM members WHERE public_slug = ?",
    [slug]
  );
  if (!member) notFound();

  const tasted = await all<{ sake_id: number; count: number }>(
    "SELECT sake_id, count FROM member_tasted WHERE line_user_id = ?",
    [member.line_user_id]
  );
  const kinds = tasted.length; // 集めた種類数（図鑑コレクション＝位の基準）
  const rank = rankFor(kinds);
  const next = nextRank(kinds);

  // 集めた銘柄（写真/色つきミニ図鑑）
  const ids = tasted.map((t) => t.sake_id);
  const collected = ids.length
    ? (await all<SakeRow>(`SELECT ${SAKE_COLUMNS} FROM sakes WHERE archived = 0 AND id IN (${ids.map(() => "?").join(",")})`, ids)).map(toSake)
    : [];

  return (
    <main className="mx-auto min-h-dvh max-w-lg bg-gradient-to-b from-[#16352a] to-[#0f2a20] px-6 pb-16 text-[#f3efe6]">
      <div className="pt-12 text-center">
        <p className="text-[11px] font-bold tracking-[0.4em] text-[#caa86a]">酒コレ ・ 酒神コレクション</p>
        <div className="mt-5 flex flex-col items-center gap-3">
          {member.picture_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={member.picture_url} alt="" className="h-16 w-16 rounded-full ring-2 ring-[#caa86a]" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-2xl">🍶</div>
          )}
          <div className="text-lg font-bold">{member.display_name || <T ja="日本酒の旅人" en="Sake Traveler" />}</div>
          <div className="rounded-full bg-[#caa86a]/15 px-4 py-1.5 text-sm font-bold text-[#caa86a]">◆ {rank.name}</div>
        </div>
      </div>

      <div className="mt-7 text-center">
        <div className="mx-auto inline-block rounded-xl bg-white/5 px-10 py-3">
          <div className="text-3xl font-extrabold">{kinds}</div>
          <div className="mt-1 text-[10px] text-white/55"><T ja="集めた種類" en="Kinds Collected" /></div>
        </div>
      </div>
      {next && (
        <p className="mt-2 text-center text-[11px] text-white/55">
          <T ja={`あと ${next.remaining} 種で「${next.rank.name}」`} en={`${next.remaining} more to reach “${next.rank.name}”`} />
        </p>
      )}

      {collected.length > 0 && (
        <div className="mt-7">
          <p className="text-[11px] font-bold tracking-[0.16em] text-white/55"><T ja="集めた日本酒" en="Sake Collected" /></p>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {collected.slice(0, 30).map((s) => (
              <div key={s.id} className="overflow-hidden rounded-lg bg-white/10" title={s.brand}>
                <div className="flex h-14 items-center justify-center" style={{ background: `color-mix(in srgb, ${s.labelColor} 30%, transparent)` }}>
                  {s.hasPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl(s.id, s.updatedAt)} alt={s.brand} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-lg">🍶</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA：見た人を来店・利用へ */}
      <div className="mt-9 rounded-2xl bg-white/8 p-5 text-center">
        <p className="text-sm font-bold"><T ja="あなたも日本酒図鑑を始めませんか？" en="Start your own sake collection" /></p>
        <p className="mt-1 text-[11px] text-white/60"><T ja="煮干しと日本酒 すぎだま ─ 常盤橋" en="Niboshi & Sake Sugidama — Tokiwabashi" /></p>
        <Link href={SITE} className="mt-4 inline-block rounded-full bg-[#caa86a] px-6 py-3 text-sm font-bold text-[#16352a]">
          <T ja="図鑑を見る・始める →" en="View & start the collection →" />
        </Link>
      </div>
    </main>
  );
}
