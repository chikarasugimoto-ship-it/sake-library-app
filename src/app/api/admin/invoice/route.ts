import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { all, audit } from "@/lib/db";
import { aiAvailable, recognizeInvoice } from "@/lib/ai";
import { getSettings, computeSellPrice } from "@/lib/pricing";

function norm(s: string) {
  return String(s ?? "").replace(/[\s　・]/g, "").toLowerCase();
}

// 納品書/領収書を読み取り、各明細に「自動算出した売価」を付けてドラフトを返す
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiAvailable()) return NextResponse.json({ error: "AIキーが未設定です（ANTHROPIC_API_KEY）" }, { status: 503 });
  const { image, media_type } = (await req.json()) as { image?: string; media_type?: string };
  if (!image) return NextResponse.json({ error: "データがありません" }, { status: 400 });
  const mt = media_type || "image/jpeg";
  const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!ALLOWED.includes(mt)) return NextResponse.json({ error: "対応していない形式です（画像かPDF）" }, { status: 400 });
  const maxLen = mt === "application/pdf" ? 9_000_000 : 4_000_000; // base64長（PDFは約6MB・画像は約3MBまで）
  if (image.length > maxLen)
    return NextResponse.json({ error: mt === "application/pdf" ? "PDFが大きすぎます（約6MBまで）" : "画像が大きすぎます" }, { status: 400 });

  try {
    const { supplier, items, quality, note } = await recognizeInvoice(image, mt);
    const settings = await getSettings();
    const sakes = await all<{ id: number; brand: string; grade: string; kubun: string }>(
      "SELECT id, brand, grade, kubun FROM sakes WHERE archived = 0"
    );
    const draft = items.map((it) => {
      const key = norm(it.brand);
      // 既存銘柄とのマッチ（名前の包含・正規化一致）
      const matched = sakes.find((s) => {
        const full = norm(s.brand + s.grade);
        const b = norm(s.brand);
        return full === key || b === key || (b.length >= 3 && (key.includes(b) || b.includes(key)));
      });
      const kubun = matched?.kubun || "通常";
      const price = it.cost_excl_tax ? computeSellPrice(it.cost_excl_tax, it.bottle_size, kubun, settings) : 0;
      return {
        brand: it.brand,
        bottle_size: it.bottle_size,
        cost_excl_tax: it.cost_excl_tax,
        qty: it.qty,
        kubun,
        price,
        sakeId: matched?.id ?? null,
        matchedName: matched ? [matched.brand, matched.grade].filter(Boolean).join(" ") : null,
        confidence: it.confidence,
        uncertain: it.uncertain,
      };
    });
    await audit("invoice.scan", { supplier, count: draft.length, quality });
    return NextResponse.json({ supplier, items: draft, settings, quality, note });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "読み取りに失敗しました" }, { status: 500 });
  }
}
