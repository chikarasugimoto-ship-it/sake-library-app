import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/db";

// スマレジ プライベートアプリの「利用者契約通知先URL」。
// アクティベート時に契約ID等がPOSTされる。受け取って200を返すだけ（記録は監査ログへ）。
export async function POST(req: NextRequest) {
  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    try {
      const form = await req.formData();
      payload = Object.fromEntries(form.entries());
    } catch {
      payload = null;
    }
  }
  await audit("smaregi.activate", payload);
  return NextResponse.json({ ok: true });
}

// 疎通確認用（ブラウザで開ける）
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "smaregi-activate" });
}
