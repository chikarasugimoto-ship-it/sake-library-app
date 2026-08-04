import { NextRequest, NextResponse } from "next/server";
import { all } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { redeemReward } from "@/lib/rewards";

export const dynamic = "force-dynamic";

// 直近の引換コード一覧（発行・消し込みの確認用）
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // お客様が選んだ隠し酒の銘柄も同梱＝スタッフが「どの隠し酒を注ぐか」を一目で確認できる
  const rows = await all<{ id: number; code: string; reason: string; owner_kind: string; status: string; issued_at: string; redeemed_at: string; sake_id: number; sake_brand: string }>(
    `SELECT rg.id, rg.code, rg.reason, rg.owner_kind, rg.status, rg.issued_at, rg.redeemed_at, rg.sake_id,
            COALESCE(s.brand, '') AS sake_brand
       FROM reward_grants rg LEFT JOIN sakes s ON s.id = rg.sake_id
      ORDER BY rg.id DESC LIMIT 40`
  );
  return NextResponse.json({ rewards: rows });
}

// コードを消し込む（店頭でお客様が提示→スタッフが入力）
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { code?: string };
  const code = String(b.code || "").trim();
  if (!code) return NextResponse.json({ error: "no_code" }, { status: 400 });
  const result = await redeemReward(code, "staff");
  if (result === "not_found") return NextResponse.json({ error: "not_found", message: "このコードは見つかりません" }, { status: 404 });
  if (result === "already") return NextResponse.json({ error: "already", message: "このコードは引換済みです" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
