import { NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/db";

// スマレジ Webhook送信先（任意）。各種イベント通知を受けて200を返す。
export async function POST(req: NextRequest) {
  let payload: unknown = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }
  await audit("smaregi.webhook", payload);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "smaregi-webhook" });
}
