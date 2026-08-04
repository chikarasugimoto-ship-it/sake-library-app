import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { run, audit } from "@/lib/db";
import { isAdmin } from "@/lib/auth";

// ドラッグ＆ドロップ並び替えの一括保存
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { ids } = (await req.json()) as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((n) => !Number.isInteger(n))) {
    return NextResponse.json({ error: "invalid ids" }, { status: 400 });
  }
  for (let i = 0; i < ids.length; i++) {
    await run("UPDATE sakes SET sort_order = ? WHERE id = ?", [i + 1, ids[i]]);
  }
  await audit("sake.sort", { count: ids.length });
  revalidatePath("/");
  revalidatePath("/zukan");
  return NextResponse.json({ ok: true });
}
