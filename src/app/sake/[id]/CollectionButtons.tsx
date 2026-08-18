"use client";

import { useCollection, formatDate } from "@/lib/collection";
import { T } from "@/components/T";

// 詳細ページの図鑑ステータス。手動登録は廃止＝注文すると自動で図鑑に登録される。
export function CollectionButtons({ id }: { id: number; total?: number }) {
  const { tasted, ready } = useCollection();
  const entry = tasted.get(id);
  const isTasted = !!entry;

  return (
    <div className="mt-6">
      {ready && isTasted ? (
        <div className="w-full rounded-full bg-moss py-4 text-center text-[15px] font-bold tracking-wider text-white">
          ✓ <T ja="図鑑に登録済み" en="Added to your collection" />{entry!.date ? `（${formatDate(entry!.date)}）` : ""}
        </div>
      ) : (
        <div className="w-full rounded-2xl border border-moss bg-card px-3 py-4 text-center">
          <p className="text-sm font-bold text-moss-deep">🍶 <T ja="ご注文で図鑑に登録されます" en="Order this to add it to your collection" /></p>
          <p className="mt-1 text-[11px] text-ink-soft"><T ja="注文した日本酒が、自動でコレクションに加わります（同じお酒は1回だけ）" en="Each sake you order is added automatically (once per label)" /></p>
          {/* 特典訴求（2026-08-18 オーナー指示）: 30種で隠し酒プレゼントを一言。
              「提供中の銘柄から選べます」は事実誤認のため修正（2026-08-18 杉本さんフィードバック）＝
              隠し酒はメニューに出していない特別なお酒（is_hidden。listHiddenGodsの内部ロジックは正しいので変更なし） */}
          <p className="mt-1.5 text-[11px] font-bold text-[#8a6a25]">🎁 <T ja="30種類集めると、メニューに載っていない特別な一本「隠し酒」を1杯プレゼント" en="Collect 30 kinds and receive a pour of a secret sake not on the menu" /></p>
        </div>
      )}
    </div>
  );
}
