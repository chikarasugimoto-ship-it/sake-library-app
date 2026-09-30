import { revalidatePath } from "next/cache";
import { run } from "./db";
import { recordSoldoutEvent } from "./notify";

// ============================================================================
// 注文→残数の自動減算と自動売切（残数を「意図して」管理している銘柄のみ）。
// 2026-07-24 オーナー指示の最終形: 残数未設定（NULL）の銘柄は絶対に自動売切しない。
// 残数を設定した銘柄だけ、注文で減算→0で自動売切→補充で自動復活が働く。
// ※以前の事故（くどき上手・黒龍・神亀・上喜元…が“勝手に売切”）は、在庫ボードの「＋」誤タップ等で
//   知らないうちに残数管理が始まっていたのが原因→在庫ボード側に「管理開始の確認」を追加して再発防止。
//
// 2026-09-30: 酒コレ自身の注文（/api/order）と、MOからの日本酒注文（/api/order/consume）の両方がここを通る。
// それまでMOの注文は残数を減らしていなかったので、「残 1 なのに何杯でも注文できる」状態だった。
// ============================================================================

export type ConsumeItem = { sakeId: number; cups: number };

export async function consumeSakeStock(ordered: ConsumeItem[]): Promise<{ changed: number[]; soldout: number[] }> {
  const changed: number[] = [];
  const soldout: number[] = [];
  for (const o of ordered) {
    const cups = Math.max(0, Math.floor(Number(o.cups) || 0));
    if (!o.sakeId || cups <= 0) continue;
    try {
      // 最初の注文＝瓶を開けた合図。生酒など鮮度クロックの起点を記録（未開栓のときだけ）
      await run(
        "UPDATE sakes SET opened_at=datetime('now','localtime') WHERE id = ? AND (opened_at IS NULL OR opened_at='')",
        [o.sakeId]
      );
      // 残数は90mlグラス換算で減らす（1合・熱燗は-2）
      await run(
        "UPDATE sakes SET stock_count = MAX(0, stock_count - ?), updated_at=datetime('now','localtime') WHERE id = ? AND stock_count IS NOT NULL",
        [cups, o.sakeId]
      );
      // 売切＝その瓶は終わり。次の瓶に備えて開栓日もリセット（残数管理中の銘柄のみ到達しうる）
      const soldRes = await run(
        "UPDATE sakes SET status='soldout', soldout_at=datetime('now','localtime'), opened_at='' WHERE id = ? AND stock_count = 0 AND status != 'soldout'",
        [o.sakeId]
      );
      // 注文で残数0→自動売切になった瞬間だけ売切イベントを記録（夜のスマート日報がまとめて報告）
      if (soldRes.rowsAffected > 0) {
        soldout.push(o.sakeId);
        await recordSoldoutEvent(o.sakeId);
      }
      changed.push(o.sakeId);
    } catch {
      // 在庫更新の失敗で注文自体は止めない
    }
  }
  if (changed.length) {
    revalidatePath("/");
    revalidatePath("/zukan");
    for (const id of changed) revalidatePath(`/sake/${id}`);
  }
  return { changed, soldout };
}
