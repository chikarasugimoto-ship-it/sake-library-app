import { all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake } from "@/lib/types";
import { listHiddenGods } from "@/lib/rewards";
import { Zukan } from "./Zukan";

// ISRでキャッシュ＝タブ切替が即時。在庫変更時は管理APIから revalidatePath で即反映
export const revalidate = 30;

export default async function ZukanPage() {
  // 酒神メタ(レア度・酒神名)を LEFT JOIN。updated_at が sakes/gods 両方にあり曖昧になるため
  // 内側サブクエリ(JOINなし)で SAKE_COLUMNS を確定させてから gods を外側で結合する。
  const rows = await all<SakeRow & { god_rarity: string | null; god_name: string | null; god_has_art: number | null; god_updated: string | null }>(
    `SELECT base.*, g.rarity AS god_rarity, g.name AS god_name,
            (g.god_art IS NOT NULL OR g.god_art_url <> '') AS god_has_art, g.updated_at AS god_updated
       FROM (SELECT ${SAKE_COLUMNS} FROM sakes WHERE archived = 0 AND is_hidden = 0 AND photo IS NOT NULL) base
       LEFT JOIN gods g ON g.sake_id = base.id
      ORDER BY base.sort_order, base.id`
  );
  // 図鑑用に必要な情報だけ
  const entries = rows.map((row) => {
    const s = toSake(row);
    return {
      id: s.id,
      brand: s.brand,
      brewery: s.brewery,
      prefecture: s.prefecture,
      labelColor: s.labelColor,
      hasPhoto: s.hasPhoto,
      isPremium: s.isPremium,
      grade: s.grade,
      price: s.price,
      volume: s.volume,
      status: s.status,
      updatedAt: s.updatedAt,
      rarity: row.god_rarity || "",
      godName: row.god_name || "",
      hasArt: !!row.god_has_art,
      godUpdated: row.god_updated || "",
      en: s.en,
    };
  });
  // 隠し酒プレゼントで選べる隠し酒の一覧（提供中・売切でない）。客側引換ピッカーで使う。
  const hiddenGods = await listHiddenGods();
  return (
    <main className="mx-auto max-w-lg pb-28">
      <Zukan entries={entries} hiddenGods={hiddenGods} />
    </main>
  );
}
