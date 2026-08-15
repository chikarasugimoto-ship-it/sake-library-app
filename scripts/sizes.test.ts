// sizes.ts（サイズ共通契約）の単体テスト。実行: node scripts/sizes.test.ts（Node 23+ の型ストリップで動く）
import {
  CUPS,
  normalizeSize,
  priceFor,
  sizeSuffix,
  withSizeSuffix,
  stripSizeSuffix,
  cupsFromName,
} from "../src/lib/sizes.ts";

let failed = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`NG ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  } else {
    console.log(`ok ${label}`);
  }
}

// --- normalizeSize（旧body互換: size未指定/不正 → glass） ---
eq(normalizeSize(undefined), "glass", "normalizeSize(undefined)=glass");
eq(normalizeSize(null), "glass", "normalizeSize(null)=glass");
eq(normalizeSize(""), "glass", "normalizeSize('')=glass");
eq(normalizeSize("GO"), "glass", "normalizeSize('GO')=glass（大文字は不正扱い）");
eq(normalizeSize("tokkuri"), "glass", "normalizeSize('tokkuri')=glass");
eq(normalizeSize("glass"), "glass", "normalizeSize('glass')=glass");
eq(normalizeSize("go"), "go", "normalizeSize('go')=go");
eq(normalizeSize("kan"), "kan", "normalizeSize('kan')=kan");

// --- CUPS（90ml換算） ---
eq(CUPS.glass, 1, "CUPS.glass=1");
eq(CUPS.go, 2, "CUPS.go=2");
eq(CUPS.kan, 2, "CUPS.kan=2");

// --- priceFor（1合・熱燗=常にグラス×2） ---
eq(priceFor(700, "glass"), 700, "priceFor(700,glass)=700");
eq(priceFor(700, "go"), 1400, "priceFor(700,go)=1400");
eq(priceFor(700, "kan"), 1400, "priceFor(700,kan)=1400");
eq(priceFor(1250, "go"), 2500, "priceFor(1250,go)=2500");

// --- suffix・strip の往復 ---
eq(sizeSuffix("glass"), "", "sizeSuffix(glass)=''");
eq(sizeSuffix("go"), "（1合）", "sizeSuffix(go)");
eq(sizeSuffix("kan"), "（1合・熱燗）", "sizeSuffix(kan)");
eq(withSizeSuffix("酔鯨 純米吟醸", "go"), "酔鯨 純米吟醸（1合）", "withSizeSuffix go");
eq(withSizeSuffix("酔鯨 純米吟醸", "kan"), "酔鯨 純米吟醸（1合・熱燗）", "withSizeSuffix kan");
eq(withSizeSuffix("酔鯨 純米吟醸", "glass"), "酔鯨 純米吟醸", "withSizeSuffix glass=付記なし");
for (const size of ["glass", "go", "kan"] as const) {
  eq(stripSizeSuffix(withSizeSuffix("上喜元 特別純米", size)), "上喜元 特別純米", `strip往復(${size})`);
}
eq(stripSizeSuffix("黒龍"), "黒龍", "strip: 付記なしは不変");
eq(stripSizeSuffix("（1合）のつく変な銘柄（1合）"), "（1合）のつく変な銘柄", "strip: 末尾のみ除去");
eq(stripSizeSuffix("銘柄（1合・熱燗）"), "銘柄", "strip: 熱燗付記も除去");

// --- 85字境界（suffixはslice後に付与＝絶対に欠けない） ---
const long = "あ".repeat(100);
const base85 = "い".repeat(85);
eq(withSizeSuffix(long, "glass").length, 85, "85字境界: glassは85で切る");
{
  const v = withSizeSuffix(long, "go");
  eq(v.length, 85, "85字境界: goも合計85以内");
  eq(v.endsWith("（1合）"), true, "85字境界: goのsuffixが末尾に完全に残る");
  eq(cupsFromName(v, 1), 2, "85字境界: 切ってもcups換算が2のまま");
}
{
  const v = withSizeSuffix(long, "kan");
  eq(v.length, 85, "85字境界: kanも合計85以内");
  eq(v.endsWith("（1合・熱燗）"), true, "85字境界: kanのsuffixが末尾に完全に残る");
  eq(stripSizeSuffix(v), "あ".repeat(85 - "（1合・熱燗）".length), "85字境界: strip往復で本体だけ残る");
}
eq(withSizeSuffix(base85, "glass"), base85, "85字ちょうど: glassは不変");
eq(withSizeSuffix(base85, "go").length, 85, "85字ちょうど: go付与後も85");

// --- cupsFromName（日報・集計の杯数換算） ---
eq(cupsFromName("酔鯨 純米吟醸", 3), 3, "cupsFromName 付記なし=×1");
eq(cupsFromName("酔鯨 純米吟醸（1合）", 1), 2, "cupsFromName（1合）=×2");
eq(cupsFromName("酔鯨 純米吟醸（1合・熱燗）", 2), 4, "cupsFromName（1合・熱燗）=×2");
eq(cupsFromName("（1合）が先頭にある銘柄", 1), 1, "cupsFromName 末尾以外は×1");
eq(cupsFromName("銘柄", 0), 0, "cupsFromName qty=0");
eq(cupsFromName("銘柄（1合）", -1), 0, "cupsFromName 負数は0");

if (failed) {
  console.error(`\n${failed} 件失敗`);
  process.exit(1);
}
console.log("\n全テストOK");
