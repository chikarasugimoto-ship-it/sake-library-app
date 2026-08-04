import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/auth";
import { all, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake } from "@/lib/types";
import { ArchiveList } from "./ArchiveList";

export const dynamic = "force-dynamic";

// 在庫から外した日本酒（売切れ＝翌日に自動／消去＝手動🗑）を確認・復元する。
export default async function ArchivePage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const rows = await all<SakeRow & { archived: number }>(
    `SELECT ${SAKE_COLUMNS}, archived FROM sakes
     WHERE archived = 1
        OR (status = 'soldout' AND soldout_at != '' AND date(soldout_at) < date('now','localtime'))
     ORDER BY (CASE WHEN archived = 1 THEN updated_at ELSE soldout_at END) DESC, id DESC`
  );
  const items = rows.map((row) => {
    const s = toSake(row);
    const deleted = row.archived === 1;
    return {
      id: s.id,
      brand: s.brand,
      grade: s.grade,
      hasPhoto: s.hasPhoto,
      labelColor: s.labelColor,
      type: deleted ? ("deleted" as const) : ("soldout" as const),
      date: deleted ? s.updatedAt : s.soldoutAt,
    };
  });
  return (
    <main className="mx-auto max-w-lg pb-16">
      <header className="px-6 pt-12 pb-2">
        <Link href="/admin" className="text-xs text-ink-soft">
          ‹ 在庫ボードへ戻る
        </Link>
        <h1 className="mt-2 text-2xl font-bold">在庫から外した日本酒</h1>
        <p className="mt-1 text-xs text-ink-soft">
          売切れ（翌日に自動で外れます）と、消去したものをここで確認・復元できます。
        </p>
      </header>
      <ArchiveList initial={items} />
    </main>
  );
}
