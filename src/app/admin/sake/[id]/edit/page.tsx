import { redirect, notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { get, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { toSake } from "@/lib/types";
import { EditSake } from "./EditSake";

export const dynamic = "force-dynamic";

// 管理側：日本酒の詳細・残数を編集（写真の撮り直しも）。
export default async function EditSakePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { id } = await params;
  const row = await get<SakeRow>(`SELECT ${SAKE_COLUMNS} FROM sakes WHERE id = ? AND archived = 0`, [Number(id)]);
  if (!row) notFound();
  return <EditSake sake={toSake(row)} />;
}
