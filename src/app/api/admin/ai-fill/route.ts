import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { aiAvailable, enrichSakeFromText } from "@/lib/ai";
import { audit } from "@/lib/db";

// Web検索を含むため余裕を持たせる
export const maxDuration = 60;

// 銘柄・都道府県・酒蔵（人が確認した正しい情報）から、残りの項目をAIが入れ直す。
// ラベル誤認識の修正用。brand/prefecture/brewery は変更しない。
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiAvailable()) {
    return NextResponse.json({ error: "AIキーが未設定です（ANTHROPIC_API_KEY）" }, { status: 503 });
  }
  const { brand, prefecture, brewery, sub_name } = (await req.json()) as {
    brand?: string;
    prefecture?: string;
    brewery?: string;
    sub_name?: string;
  };
  if (!brand?.trim()) return NextResponse.json({ error: "銘柄を入れてください" }, { status: 400 });
  try {
    const result = await enrichSakeFromText({ brand, prefecture, brewery, subName: sub_name });
    await audit("sake.ai_fill", { brand, prefecture, brewery });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI補完に失敗しました" },
      { status: 500 }
    );
  }
}
