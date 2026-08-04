import { NextRequest, NextResponse } from "next/server";
import { get } from "@/lib/db";

export const dynamic = "force-dynamic";

// 採用したマスコット「すぎだまる」を配信。settings の mascot_url（Blob）へリダイレクト。
// ?variant=advisor で相談役すぎだまる（眼鏡＋本・自由の女神ポーズ）。中身が変わってもURLは同じなので ver でキャッシュバスティング。
export async function GET(req: NextRequest) {
  const advisor = req.nextUrl.searchParams.get("variant") === "advisor";
  const urlKey = advisor ? "mascot_advisor_url" : "mascot_url";
  const verKey = advisor ? "mascot_advisor_ver" : "mascot_ver";
  const [u, v] = await Promise.all([
    get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [urlKey]),
    get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [verKey]),
  ]);
  const url = u?.value || "";
  if (!url) return NextResponse.json({ error: "no_mascot" }, { status: 404 });
  const ver = v?.value || "1";
  const dest = url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(ver);
  return NextResponse.redirect(dest, 308);
}
