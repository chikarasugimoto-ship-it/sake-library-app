// ============================================================================
// 日本酒の提供サイズ（グラス90ml / 1合180ml / 熱燗1合）の共通契約。
// 【重要】両リポジトリで同期必須:
//   - sake-library-app/src/lib/sizes.ts      （このファイル）
//   - sugidama-mo/src/lib/sake-sizes.ts      （複製。片方を変えたら必ずもう片方も）
// 契約（2026-08 オーナー裁定）:
//   SakeSize = "glass" | "go" | "kan"        // 90ml / 1合180ml / 熱燗1合（徳利のみ）
//   価格: glass = sakes.price、go/kan = price × 2（常に2倍・例外なし）
//   杯数換算: CUPS = { glass:1, go:2, kan:2 } // 90mlグラス基準（集計・在庫減算・図鑑加算用）
//   表記: go=「銘柄名（1合）」 kan=「銘柄名（1合・熱燗）」（suffixはsliceの後に付ける＝欠けさせない）
// ============================================================================

export type SakeSize = "glass" | "go" | "kan";

export const SAKE_SIZES: readonly SakeSize[] = ["glass", "go", "kan"] as const;

// 90mlグラス基準の杯数換算（1合=2杯）。在庫減算・図鑑count・杯数集計はこれを掛ける
export const CUPS: Record<SakeSize, number> = { glass: 1, go: 2, kan: 2 };

// 不正・未指定は "glass"（旧クライアント互換＝sizeなしのbodyは従来どおりグラス扱い）
export function normalizeSize(v: unknown): SakeSize {
  return v === "go" || v === "kan" ? v : "glass";
}

// サイズ後の単価。1合・熱燗は常にグラス価格の2倍（オーナー裁定・例外なし）
export function priceFor(basePrice: number, size: SakeSize): number {
  return size === "glass" ? basePrice : basePrice * 2;
}

// 表示名につけるサイズ付記（glassは付記なし＝従来表記と同一）
export function sizeSuffix(size: SakeSize): string {
  return size === "go" ? "（1合）" : size === "kan" ? "（1合・熱燗）" : "";
}

// 銘柄名にサイズ付記をつける。suffixが欠けると集計（cupsFromName）が狂うため、
// 全体が max 文字に収まるよう「先に本体をsliceしてから」suffixを付ける（suffixは絶対に切らない）。
export function withSizeSuffix(name: string, size: SakeSize, max = 85): string {
  const sfx = sizeSuffix(size);
  if (!sfx) return name.slice(0, max);
  return name.slice(0, Math.max(1, max - sfx.length)) + sfx;
}

// サイズ付記を外して素の銘柄名に戻す（日報の銘柄マージ用。「（1合）」が別銘柄に割れないように）
export function stripSizeSuffix(name: string): string {
  return String(name ?? "").replace(/（1合(・熱燗)?）$/, "");
}

// 注文明細の表示名＋提供数 → 90ml換算の杯数。付記なし=×1（過去データは従来どおり）
export function cupsFromName(name: string, qty: number): number {
  const n = Math.max(0, Number(qty) || 0);
  return /（1合(・熱燗)?）$/.test(String(name ?? "")) ? n * 2 : n;
}

// UI表示用ラベル（酒コレ・MO共通の文言）
export function sizeLabel(size: SakeSize, lang: "ja" | "en" = "ja"): string {
  if (lang === "en") {
    return size === "go" ? "Gō carafe" : size === "kan" ? "Hot sake · gō" : "Glass (90ml)";
  }
  // 容量mlの明記はグラスのみ（2026-08-18 オーナー指示「1合・熱燗に180mlの記載はしない」）
  return size === "go" ? "1合" : size === "kan" ? "熱燗1合" : "グラス(90ml)";
}

// 1合・熱燗はグラス2杯ぶん（CUPS）。残数管理している銘柄で残りが1杯しかなければ提供できない。
// 2026-08-21 オーナー報告「1合を頼まれたのに出せない問題が続出」への対応。
// 残数を管理していない銘柄（null=無制限）は常に注文可。
export function canOrderGo(stockCount: number | null | undefined): boolean {
  return stockCount == null || stockCount >= CUPS.go;
}
