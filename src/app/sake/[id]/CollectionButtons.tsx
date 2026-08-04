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
        <div className="w-full rounded-2xl border border-moss bg-card py-4 text-center">
          <p className="text-sm font-bold text-moss-deep">🍶 <T ja="ご注文で図鑑に登録されます" en="Order this to add it to your collection" /></p>
          <p className="mt-1 text-[11px] text-ink-soft"><T ja="注文した日本酒が、自動でコレクションに加わります（同じお酒は1回だけ）" en="Each sake you order is added automatically (once per label)" /></p>
        </div>
      )}
    </div>
  );
}
