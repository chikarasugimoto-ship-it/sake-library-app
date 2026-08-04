import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { aiAvailable, recognizeLabel, describeSake } from "@/lib/ai";
import { audit } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiAvailable()) {
    return NextResponse.json({ error: "AIキーが未設定です（ANTHROPIC_API_KEY）" }, { status: 503 });
  }
  const { image, media_type } = (await req.json()) as { image?: string; media_type?: string };
  if (!image) return NextResponse.json({ error: "画像がありません" }, { status: 400 });
  if (image.length > 2_400_000) return NextResponse.json({ error: "画像が大きすぎます" }, { status: 400 });
  try {
    const result = await recognizeLabel(image, media_type || "image/jpeg");
    // 銘柄を特定できたら、複数サイトをWeb検索して魅力的な紹介文に差し替え（失敗時は元の説明を維持）
    if (result.brand) {
      const researched = await describeSake({
        brand: result.brand,
        subName: result.sub_name,
        brewery: result.brewery,
        prefecture: result.prefecture,
        grade: result.grade,
      });
      if (researched) result.description = researched;
    }
    await audit("sake.recognize", { brand: result.brand, confidence: result.confidence });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI認識に失敗しました" },
      { status: 500 }
    );
  }
}
