import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { all, get, run, audit } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { consumeSakeStock } from "@/lib/stock-consume";
import {
  smaregiConfigured,
  orderingEnabled,
  listActiveTableUses,
  placeOrder,
  listWaiterMenus,
  resolveSakeMenu,
  resolveMenuFor,
  sakeOrderName,
  type OrderItemInput,
  type TableUse,
} from "@/lib/smaregi";
import { type SakeSize, normalizeSize, priceFor, withSizeSuffix, CUPS } from "@/lib/sizes";

const TABLE_COOKIE = "sksl_table";
const TUSE_COOKIE = "sksl_tuse"; // 注文中の卓セッション(table_use)にひもづけ。会計後の再注文・退店者の誤注文を防ぐ

// 卓名はアルファベット＋数字（C1, B2…）。大文字化＋英数字以外除去で完全一致照合（数字抜き出しは衝突するため不可）
function normTable(name: string): string {
  return String(name ?? "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// 観測したテーブル利用から 卓番号→内部テーブルID を学習（チェックイン作成用）
async function learnTableIds(uses: TableUse[]) {
  for (const u of uses) {
    for (const t of u.tables || []) {
      const num = normTable(t.name);
      if (!num || !t.id) continue;
      await run(
        `INSERT INTO table_map (table_number, smaregi_table_id, table_name, updated_at)
         VALUES (?, ?, ?, datetime('now','localtime'))
         ON CONFLICT(table_number) DO UPDATE SET smaregi_table_id = excluded.smaregi_table_id, table_name = excluded.table_name, updated_at = excluded.updated_at`,
        [num, String(t.id), String(t.name)]
      );
    }
  }
}

type SakeRow = { id: number; brand: string; grade: string; price: number | null; smaregi_product_id: string; status: string; kan_ok: number | null };

export async function POST(req: NextRequest) {
  if (!orderingEnabled()) return NextResponse.json({ error: "ordering_disabled" }, { status: 503 });
  if (!smaregiConfigured()) return NextResponse.json({ error: "smaregi_unconfigured" }, { status: 503 });

  const c = await cookies();
  const tableNumber = normTable(c.get(TABLE_COOKIE)?.value || "");
  if (!tableNumber) return NextResponse.json({ error: "no_table", message: "卓のQRから開いてください" }, { status: 400 });
  // 暴走連投の防止（1卓あたり）。通常は十分余裕のある値
  if (!rateLimit("order:" + tableNumber, 20, 60_000)) {
    return NextResponse.json({ error: "rate_limited", message: "少し時間をおいてお試しください" }, { status: 429 });
  }

  // size（グラス/1合/熱燗）はオプション。不正・未指定は "glass"＝旧クライアント（キャッシュ済みページ）互換
  const body = (await req.json().catch(() => null)) as { items?: { sakeId: number; quantity: number; size?: string }[] } | null;
  const reqItems = (body?.items || []).filter((i) => i && i.sakeId && i.quantity > 0);
  if (!reqItems.length) return NextResponse.json({ error: "empty_cart" }, { status: 400 });

  // 注文対象の日本酒をDBから取得
  const ids = reqItems.map((i) => Number(i.sakeId));
  const placeholders = ids.map(() => "?").join(",");
  const rows = await all<SakeRow>(
    `SELECT id, brand, grade, price, smaregi_product_id, status, kan_ok FROM sakes WHERE id IN (${placeholders}) AND archived = 0`,
    ids
  );
  const byId = new Map(rows.map((r) => [r.id, r]));

  // 方式A：オープン価格の「日本酒」メニュー1つを使い、銘柄名・価格は注文時に送る
  let menus;
  try {
    menus = await listWaiterMenus();
  } catch (e) {
    return NextResponse.json({ error: "smaregi_error", detail: String(e).slice(0, 200) }, { status: 502 });
  }
  // 銘柄ごとの専用メニュー(distinct menuId)があればそれを優先＝同額でも会計で別商品として分かれる。
  // 無い銘柄は方式A（オープン価格の共通「日本酒」メニュー）にフォールバック（同額は会計でまとまる）。
  const sakeMenu = resolveSakeMenu(menus);

  const items: OrderItemInput[] = [];
  // S0: 集計用に price/brand も残す（客単価・プレミア率を audit_logs から後で出せるように）。
  // 2026-08-16 サイズ対応: size と cups（90ml換算杯数）も記録。price は「サイズ後の単価」（1合・熱燗=グラス×2）
  const ordered: { sakeId: number; quantity: number; size: SakeSize; cups: number; price: number; brand: string }[] = [];
  const unresolved: { sakeId: number; brand?: string }[] = [];   // 見つからない/価格未設定/メニュー未設定/熱燗不可
  for (const it of reqItems) {
    const s = byId.get(Number(it.sakeId));
    const size = normalizeSize(it.size); // 不正・未指定は glass（旧クライアント互換）
    if (!s || !s.price || s.price <= 0) {
      unresolved.push({ sakeId: it.sakeId, brand: s?.brand });
      continue;
    }
    // 売り切れはサーバーで最終拒否（客がページを開いたまま＝カートに残したまま、営業中に
    // 管理画面で売切にされたケース。クライアント表示だけに頼らない）。カートに残してスタッフ対応へ。
    if (s.status === "soldout") {
      unresolved.push({ sakeId: it.sakeId, brand: s.brand });
      continue;
    }
    // 熱燗はサーバーで最終検証（kan_ok を営業中にOFFにされたケース）。NGはカートに残してスタッフ対応へ
    if (size === "kan" && !s.kan_ok) {
      unresolved.push({ sakeId: it.sakeId, brand: s.brand });
      continue;
    }
    // サイズ後の単価と表示名（「銘柄名（1合）」「銘柄名（1合・熱燗）」。suffixはslice後に付与＝欠けない）
    const unitPrice = priceFor(s.price, size);
    const name = withSizeSuffix(sakeOrderName(s), size);
    const own = resolveMenuFor(menus, { smaregiProductId: s.smaregi_product_id, brand: s.brand, grade: s.grade });
    if (own) {
      // 専用メニュー＝別商品。会計で同額の他銘柄とまとまらない。価格はアプリ側を正として送る（メニューの税設定は流用）
      items.push({ menuId: own.menuId, quantity: it.quantity, name, sellingPrice: { ...own.sellingPrice, amount: String(unitPrice) } });
    } else if (sakeMenu) {
      items.push({
        menuId: sakeMenu.menuId,
        quantity: it.quantity,
        name,
        sellingPrice: { amount: String(unitPrice), tax: "included", taxRate: sakeMenu.taxRate, taxType: sakeMenu.taxType },
      });
    } else {
      unresolved.push({ sakeId: it.sakeId, brand: s.brand });
      continue;
    }
    ordered.push({ sakeId: s.id, quantity: it.quantity, size, cups: it.quantity * CUPS[size], price: unitPrice, brand: s.brand });
  }

  // #19 部分成功化：注文できる銘柄が1つでもあれば通す（未解決は unresolved で返してカートに残す）。
  // 全部だめな時だけ止める＝価格未設定の1本でカゴ全体が落ちる事故を防ぐ。
  if (!items.length) {
    return NextResponse.json(
      { error: "unorderable_items", unresolved, message: "ご注文できる銘柄がありませんでした（売り切れ・価格未設定など）。スタッフへお声がけください。" },
      { status: 409 }
    );
  }

  // 卓のアクティブなテーブル利用を探す（無ければ学習済みIDでチェックイン）
  let uses: TableUse[];
  try {
    uses = await listActiveTableUses();
  } catch (e) {
    return NextResponse.json({ error: "smaregi_error", detail: String(e).slice(0, 200) }, { status: 502 });
  }
  await learnTableIds(uses);

  const tableUse = uses.find((u) => (u.tables || []).some((t) => normTable(t.name) === tableNumber)) || null;

  // アクティブな卓セッションが無ければ受け付けない（自動チェックインしない）。
  // ＝退店後・お会計後にクッキーが残っていても「幽霊注文」を作らせない。
  if (!tableUse) {
    return NextResponse.json(
      {
        error: "table_closed",
        message: "ただいまご注文を受け付けていません。お席で卓のQRを読み込んでください（お会計後はもう一度の読み込みが必要です）。ご不明な点はスタッフへ。",
      },
      { status: 409 }
    );
  }

  // 会計後に卓が別セッションになった/席が変わった場合は、QR再読み込みを必須にする
  // （退店した人のクッキーで、別のお客様の卓に注文が紛れ込むのを防ぐ）。
  const boundTuse = c.get(TUSE_COOKIE)?.value || "";
  if (boundTuse && boundTuse !== String(tableUse.id)) {
    const res = NextResponse.json(
      { error: "table_changed", message: "お会計が済んでいるか席が変わっています。お席の卓QRをもう一度読み込んでからご注文ください。" },
      { status: 409 }
    );
    res.cookies.delete(TUSE_COOKIE);
    return res;
  }

  // 注文投入
  try {
    const placed = await placeOrder(tableUse.id, items);
    const orderTotal = ordered.reduce((n, o) => n + o.price * o.quantity, 0);
    await audit("order.placed", {
      table: tableNumber,
      tableUseId: tableUse.id,
      orderId: placed.orderId,
      setKind: "single", // 将来 'flight3'(飲み比べ) 等を入れるための区別
      total: orderTotal,
      items: ordered, // {sakeId, quantity, size, cups, price, brand}＝客単価・杯数集計に使う（旧ログは cups なし→ cups ?? quantity で後方互換）
      unresolved: unresolved.length,
    });

    // 【橋渡し】日本酒注文をモバイルオーダー(MO)の自作キッチンモニターにも表示する（表示専用チケット）。
    //  会計はスマレジ（上のplaceOrder）が担当。ここはKM表示のためだけ。失敗しても注文は成立させる。
    //  env MO_KITCHEN_INGEST_URL / MO_KITCHEN_TOKEN 未設定なら何もしない（＝橋渡しOFF）。
    const ingestUrl = process.env.MO_KITCHEN_INGEST_URL;
    const ingestToken = process.env.MO_KITCHEN_TOKEN;
    if (ingestUrl && ingestToken) {
      try {
        const tickets = items.map((it, i) => ({
          name: it.name || "日本酒",
          qty: it.quantity,
          price: Math.max(0, Math.round(Number(it.sellingPrice?.amount) || 0)), // 単価＝MOの客注文履歴に価格を出すため
          extRef: `sksl:${placed.orderId}:${i}`, // 冪等キー（酒コレ注文ID＋行）
        }));
        await fetch(`${ingestUrl}?token=${encodeURIComponent(ingestToken)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store: "sugidama", table: tableNumber, items: tickets }),
          signal: AbortSignal.timeout(8000),
        });
      } catch (e) {
        // KMへの橋渡し失敗は注文を止めない（会計はスマレジで成立済み）。監査だけ残す。
        await audit("order.km_bridge_failed", { table: tableNumber, orderId: placed.orderId, detail: String(e).slice(0, 150) });
      }
    }

    // #9 注文→在庫の自動減算と自動売切（残数を「意図して」管理している銘柄のみ）。
    // 本体は lib/stock-consume.ts（2026-09-30 MOからの注文 /api/order/consume と共通化。動きは移動前と同一）。
    await consumeSakeStock(ordered);

    const res = NextResponse.json({ ok: true, orderId: placed.orderId, tableNumber, ordered, unresolved });
    // 初回注文でこの卓セッションにひもづけ（以降このセッションのみ。会計でセッションが変われば再読込が必要）
    if (!boundTuse) {
      res.cookies.set(TUSE_COOKIE, String(tableUse.id), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 6,
        path: "/",
      });
    }
    return res;
  } catch (e) {
    await audit("order.failed", { table: tableNumber, tableUseId: tableUse.id, detail: String(e).slice(0, 300), items: ordered });
    return NextResponse.json({ error: "order_failed", detail: String(e).slice(0, 200) }, { status: 502 });
  }
}
