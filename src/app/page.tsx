import { all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake } from "@/lib/types";
import { getDailyRecommendIds } from "@/lib/recommend-daily";
import { Library } from "./Library";

// ISRでキャッシュ＝タブ切替が即時。在庫変更時は管理APIから revalidatePath で即反映
export const revalidate = 30;

export default async function Home() {
  const rows = await all<SakeRow>(
    // 写真があるものだけお客様に表示。is_hidden（お客様の一覧に出さない・特別提供用）はメニューに出さない
    `SELECT ${SAKE_COLUMNS} FROM sakes WHERE archived = 0 AND photo IS NOT NULL AND is_hidden = 0 ORDER BY sort_order, id`
  );
  const sakes = rows.map(toSake);
  const today = new Date().toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
  // 「本日のおすすめ」は1日1回だけ確定（営業後に翌営業日ぶんへ切替）。日中は固定されたIDを返す。
  const recommendIds = await getDailyRecommendIds(sakes, Date.now());
  return <Library sakes={sakes} today={today} recommendIds={recommendIds} />;
}
