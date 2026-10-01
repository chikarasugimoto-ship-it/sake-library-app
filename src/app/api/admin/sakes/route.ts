import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { all, get, run, audit, SAKE_COLUMNS, type SakeRow } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { toSake } from "@/lib/types";
import { createSakeProduct, smaregiConfigured } from "@/lib/smaregi";
import { putImage, blobAvailable } from "@/lib/blob";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await all<SakeRow>(
    `SELECT ${SAKE_COLUMNS} FROM sakes WHERE archived = 0 ORDER BY sort_order, id`
  );
  return NextResponse.json({ sakes: rows.map(toSake) });
}

type CreateBody = {
  brand?: string;
  sub_name?: string;
  brewery?: string;
  prefecture?: string;
  grade?: string;
  price?: number | null;
  volume?: string;
  description?: string;
  taste_tags?: string[];
  pairings?: string[];
  taste_chart?: { sweet: number; acid: number; aroma: number; sharp: number };
  season_label?: string;
  is_hidden?: boolean;
  label_color?: string;
  photo_base64?: string;
  photo_type?: string;
  bottle_size?: string; // '1.8L' | '720ml'（未指定は1.8L）
};

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json()) as CreateBody;
  const brand = (b.brand ?? "").trim();
  if (!brand) return NextResponse.json({ error: "銘柄は必須です" }, { status: 400 });

  let photo: Buffer | null = null;
  if (b.photo_base64) {
    photo = Buffer.from(b.photo_base64, "base64");
    if (photo.length > 1_500_000) return NextResponse.json({ error: "写真が大きすぎます" }, { status: 400 });
  }

  const { lastInsertRowid } = await run(
    `INSERT INTO sakes
      (store_id, brand, sub_name, brewery, prefecture, grade, price, volume, description,
       taste_tags, pairings, taste_chart, season_label, is_hidden, photo, photo_type, label_color,
       bottle_size, kan_ok, delivered_at, sort_order)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
       datetime('now','localtime'), (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM sakes))`,
    [
      brand.slice(0, 60),
      (b.sub_name ?? "").slice(0, 60),
      (b.brewery ?? "").slice(0, 60),
      (b.prefecture ?? "").slice(0, 10),
      (b.grade ?? "").slice(0, 20),
      b.price ?? null,
      (b.volume ?? "90ml").slice(0, 20),
      (b.description ?? "").slice(0, 500),
      JSON.stringify((b.taste_tags ?? []).slice(0, 5)),
      JSON.stringify((b.pairings ?? []).slice(0, 5)),
      JSON.stringify(b.taste_chart ?? {}),
      (b.season_label ?? "").slice(0, 20),
      b.is_hidden ? 1 : 0,
      photo,
      photo ? (b.photo_type ?? "image/jpeg") : "",
      /^#[0-9a-fA-F]{6}$/.test(b.label_color ?? "") ? b.label_color! : "#1e3d2f",
      // 瓶の容量（既知の値のみ・PATCH側と同じ検証）。
      // ※2026-08-14のコミットで列とプレースホルダだけ追加され、この値のバインドが漏れていた
      //   （プレースホルダ17個に対し引数16個→bottle_sizeが常にNULL保存）。2026-08-18に修正。
      ["1.8L", "720ml", "750ml"].includes(String(b.bottle_size)) ? String(b.bottle_size) : null,
    ]
  );
  await audit("sake.create", { id: lastInsertRowid, brand });

  // 画像をCDN(Blob)へ。失敗してもDBのBLOBで配信できるので登録は成功扱い。
  if (photo && lastInsertRowid && blobAvailable()) {
    try {
      const url = await putImage(`photos/${lastInsertRowid}.jpg`, photo, b.photo_type || "image/jpeg");
      await run("UPDATE sakes SET photo_url = ? WHERE id = ?", [url, lastInsertRowid]);
    } catch {}
  }

  // スマレジに商品（商品名＋金額）を自動作成。失敗しても登録自体は成功扱い（手打ち回避が目的）
  let smaregi: { ok: boolean; productId?: string; error?: string } = { ok: false };
  if (smaregiConfigured() && lastInsertRowid) {
    try {
      const row = await get<SakeRow>(`SELECT ${SAKE_COLUMNS} FROM sakes WHERE id = ?`, [lastInsertRowid]);
      if (row) {
        const productId = await createSakeProduct(toSake(row));
        await run("UPDATE sakes SET smaregi_product_id = ? WHERE id = ?", [productId, lastInsertRowid]);
        await audit("smaregi.product.create", { id: lastInsertRowid, productId });
        smaregi = { ok: true, productId };
      }
    } catch (e) {
      smaregi = { ok: false, error: e instanceof Error ? e.message : "smaregi error" };
      await audit("smaregi.product.error", { id: lastInsertRowid, error: smaregi.error });
    }
  }
  revalidatePath("/");
  return NextResponse.json({ ok: true, id: lastInsertRowid, smaregi });
}
