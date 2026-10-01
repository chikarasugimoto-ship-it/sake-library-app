import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { all, run, audit } from "@/lib/db";
import { isOwner } from "@/lib/auth";
import { getSettings, computeSellPrice } from "@/lib/pricing";

// スプレッドシートの「現在店頭に出ている」分（売切でない最新納品）。写真は無し＝データ/在庫専用。
// [銘柄, 仕入単価税抜, 区分, 納品日]
const ROWS: [string, number, string, string][] = [
  ["上喜元 出羽の里純米", 2190, "通常", "2026-02-07"],
  ["上喜元 純米吟醸 超辛口", 2900, "通常", "2026-02-07"],
  ["南部美人 純米吟醸", 3900, "通常", "2026-02-20"],
  ["南部美人 本醸造 辛口", 2910, "通常", "2026-02-20"],
  ["七田 純米7割5分 山田錦火入", 2850, "通常", "2026-02-20"],
  ["七田 純米 無濾過火入", 2850, "通常", "2026-02-20"],
  ["七田 純米吟醸 無濾過火入", 3600, "通常", "2026-02-20"],
  ["東洋美人 純米吟醸50", 2500, "通常", "2026-02-20"],
  ["乾坤一 特別純米", 2900, "通常", "2026-05-20"],
  ["長良川 熟成純米", 2600, "通常", "2026-05-20"],
  ["竹葉 能登純米", 3300, "通常", "2026-05-20"],
  ["小法師 純米", 3000, "通常", "2026-05-20"],
  ["一白水成 純米吟醸 酒未来", 4200, "プレミア・希少", "2026-05-20"],
  ["上喜元 春陽", 3100, "通常", "2026-05-22"],
  ["栄光冨士 辛口純米 逸閃風刃", 2700, "通常", "2026-05-22"],
  ["たかちよ チェリちよ 生", 3200, "期間限定", "2026-05-22"],
  ["鶴齢 雪男 純米", 3450, "通常", "2026-05-22"],
  ["宮の雪 純米にごり", 2640, "通常", "2026-05-22"],
  ["會津男山 純米吟醸 百花乱舞 生", 3400, "通常", "2026-05-30"],
  ["雪の茅舎 山田穂", 4546, "通常", "2026-05-30"],
  ["くどき上手 純米大吟醸 無愛想", 8000, "プレミア・希少", "2026-05-30"],
  ["七冠馬 夏セブン", 3400, "期間限定", "2026-05-30"],
  ["天狗舞 超辛 純米酒", 2800, "通常", "2026-05-30"],
  ["栄光冨士 純米大吟醸 生原酒", 3600, "プレミア・希少", "2026-05-30"],
  ["飛良泉 山廃純米 フォーシーズン春", 3600, "期間限定", "2026-05-30"],
  ["浜福鶴 柚子日和", 3607, "通常", "2026-05-30"],
  ["残草蓬莱 純米吟醸 出羽燦々５０", 3400, "通常", "2026-06-02"],
  ["残草蓬莱 純米 緑ラベル", 2800, "通常", "2026-06-02"],
  ["昇龍蓬莱 生酒純米大吟醸 まめ農園雄町４９ 槽場直詰生原酒", 4800, "プレミア・希少", "2026-06-02"],
  ["残草蓬莱 純米吟醸 Queeen 槽場直詰生原酒", 3300, "期間限定", "2026-06-02"],
];

const norm = (s: string) => String(s ?? "").replace(/[\s　・]/g, "").toLowerCase();
const KUBUN_OK = ["通常", "プレミア・希少", "期間限定"];

// 取り込む1行（貼り付け取込のJSON行 or 固定リストから生成）
type ImportRow = { brand: string; cost: number; kubun: string; size: string; season: string; hidden: boolean; delivered: string };

// 貼り付け取込（body.rows）にも、従来の固定リスト（現店頭シード）にも対応。
// rows指定があればそれを、無ければ ROWS を取り込む。容量/季節ラベル/隠し酒は行ごとに反映。
export async function POST(req: NextRequest) {
  if (!(await isOwner())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { rows?: Array<Partial<ImportRow>> };
  const settings = await getSettings();

  const pasted = Array.isArray(body.rows) && body.rows.length > 0;
  const incoming: ImportRow[] = pasted
    ? body.rows!.map((r) => ({
        brand: String(r.brand ?? "").trim(),
        cost: Math.max(0, Math.floor(Number(r.cost) || 0)),
        kubun: KUBUN_OK.includes(String(r.kubun)) ? String(r.kubun) : "通常",
        size: String(r.size ?? "").trim() || "1.8L",
        season: String(r.season ?? "").trim(),
        hidden: !!r.hidden,
        delivered: String(r.delivered ?? "").trim(),
      }))
    : ROWS.map(([brand, cost, kubun, delivered]) => ({ brand, cost, kubun, size: "1.8L", season: "", hidden: false, delivered }));

  const existing = await all<{ brand: string }>("SELECT brand FROM sakes WHERE archived = 0");
  const have = new Set(existing.map((e) => norm(e.brand)));

  let created = 0;
  let skipped = 0;
  for (const r of incoming) {
    if (!r.brand) { skipped++; continue; }
    if (have.has(norm(r.brand))) { skipped++; continue; }
    const price = r.cost ? computeSellPrice(r.cost, r.size, r.kubun, settings) : null;
    await run(
      // kan_ok=1: 新規銘柄は既定で熱燗可（2026-08-18 オーナー指示「すべての銘柄で熱燗できるように」。不可にしたい銘柄だけ在庫ボードで個別OFF）
      `INSERT INTO sakes (store_id, brand, price, cost_excl_tax, bottle_size, kubun, kan_ok, season_label, is_hidden, delivered_at, imported, sort_order)
       VALUES (1, ?, ?, ?, ?, ?, 1, ?, ?, COALESCE(NULLIF(?, ''), datetime('now','localtime')), 1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM sakes))`,
      [r.brand, price, r.cost || null, r.size, r.kubun, r.season, r.hidden ? 1 : 0, r.delivered]
    );
    have.add(norm(r.brand));
    created++;
  }
  await audit("import.sheet", { created, skipped, pasted });
  revalidatePath("/");
  return NextResponse.json({ ok: true, created, skipped, total: incoming.length });
}
