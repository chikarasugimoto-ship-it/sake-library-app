import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { getSettings, saveSettings, type PriceSettings } from "@/lib/pricing";
import { audit } from "@/lib/db";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ settings: await getSettings() });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json()) as Partial<PriceSettings>;
  await saveSettings(b);
  await audit("settings.save", {});
  return NextResponse.json({ ok: true, settings: await getSettings() });
}
