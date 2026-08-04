import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { aiAvailable, recognizeMenu } from "@/lib/ai";
import { audit } from "@/lib/db";

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiAvailable()) return NextResponse.json({ error: "AIキー未設定" }, { status: 503 });
  const { image, media_type } = (await req.json()) as { image?: string; media_type?: string };
  if (!image) return NextResponse.json({ error: "画像がありません" }, { status: 400 });
  if (image.length > 2_800_000) return NextResponse.json({ error: "画像が大きすぎます" }, { status: 400 });
  try {
    const items = await recognizeMenu(image, media_type || "image/jpeg");
    await audit("sake.recognize_menu", { count: items.length });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "メニュー認識に失敗" }, { status: 500 });
  }
}
