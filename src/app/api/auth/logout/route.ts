import { NextResponse } from "next/server";
import { MEMBER_COOKIE } from "@/lib/line";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(MEMBER_COOKIE);
  return res;
}
