import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { get, run, audit } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { putImage, blobAvailable } from "@/lib/blob";
import { recordSoldoutEvent } from "@/lib/notify";

const STATUSES = ["available", "low", "soldout"] as const;

// 在庫状態のワンタップ切替・アーカイブ
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const sakeId = Number(id);
  // 復元（archived=false）も扱うので、削除済みも含めて存在チェックする。
  // status は「今回の操作で新たに売切になったか」の判定（売切通知の二重送信防止）に使う
  const exists = await get<{ id: number; status: string }>("SELECT id, status FROM sakes WHERE id = ?", [sakeId]);
  if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
  const wasSoldout = exists.status === "soldout";
  let becameSoldout = false; // このリクエストで 提供中→売切 になったら true（最後に1回だけ通知）

  const b = (await req.json()) as {
    status?: string;
    archived?: boolean;
    photo_base64?: string;
    photo_type?: string;
    stock?: number | null;
    beginner?: boolean;
    kanOk?: boolean; // 熱燗可（1合徳利のみ）のトグル
    fresh?: boolean | null; // 鮮度枠の手動上書き（null=自動判定 / true=必ず出す / false=出さない）
    details?: {
      brand?: string;
      sub_name?: string;
      brewery?: string;
      prefecture?: string;
      grade?: string;
      price?: number | null;
      description?: string;
      taste_tags?: string[];
      pairings?: string[];
      taste_chart?: { sweet: number; acid: number; aroma: number; sharp: number };
      season_label?: string;
      is_hidden?: boolean;
      label_color?: string;
      delivered_at?: string; // 'YYYY-MM-DD'（納品日・登録日の手直し用。形式が正しい時だけ更新）
      bottle_size?: string; // '1.8L' | '720ml'（瓶の容量。杯数の目安に使う）
    };
  };

  // 詳細の編集（管理側で全項目を上書き）
  if (b.details) {
    const d = b.details;
    if (!String(d.brand ?? "").trim()) return NextResponse.json({ error: "銘柄を入れてください" }, { status: 400 });
    await run(
      `UPDATE sakes SET brand=?, sub_name=?, brewery=?, prefecture=?, grade=?, price=?, description=?,
         taste_tags=?, pairings=?, taste_chart=?, season_label=?, is_hidden=?, label_color=?,
         updated_at=datetime('now','localtime') WHERE id=?`,
      [
        String(d.brand).trim(),
        String(d.sub_name ?? ""),
        String(d.brewery ?? ""),
        String(d.prefecture ?? ""),
        String(d.grade ?? ""),
        d.price != null && d.price !== undefined ? Number(d.price) : null,
        String(d.description ?? ""),
        JSON.stringify(Array.isArray(d.taste_tags) ? d.taste_tags.slice(0, 8) : []),
        JSON.stringify(Array.isArray(d.pairings) ? d.pairings.slice(0, 8) : []),
        JSON.stringify(d.taste_chart ?? {}),
        String(d.season_label ?? ""),
        d.is_hidden ? 1 : 0,
        String(d.label_color || "#1e3d2f"),
        sakeId,
      ]
    );
    // 納品日（登録日）の手直し。'YYYY-MM-DD' の時だけ更新（空・不正値では消さない＝データを守る）
    if (d.delivered_at !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(String(d.delivered_at))) {
      await run("UPDATE sakes SET delivered_at = ? WHERE id = ?", [`${d.delivered_at} 00:00:00`, sakeId]);
    }
    // 瓶の容量（1.8L=約20杯 / 720ml=約8杯・90ml提供の前提）。既知の値のみ受け付け
    if (d.bottle_size !== undefined && ["1.8L", "720ml", "750ml"].includes(String(d.bottle_size))) {
      await run("UPDATE sakes SET bottle_size = ? WHERE id = ?", [String(d.bottle_size), sakeId]);
    }
    await audit("sake.edit", { id: sakeId });
  }

  // 残数の設定。0で自動売切、補充(>0)で売切なら提供中へ。NULLで未設定（状態のみ運用に戻す）
  if (b.stock !== undefined) {
    if (b.stock === null) {
      await run("UPDATE sakes SET stock_count = NULL, updated_at=datetime('now','localtime') WHERE id=?", [sakeId]);
    } else {
      const n = Math.max(0, Math.min(9999, Math.floor(Number(b.stock) || 0)));
      await run("UPDATE sakes SET stock_count = ?, updated_at=datetime('now','localtime') WHERE id=?", [n, sakeId]);
      if (n === 0) {
        // 売切＝その瓶は終わり。開栓日もリセット
        await run("UPDATE sakes SET status='soldout', opened_at='' WHERE id=?", [sakeId]);
        await run("UPDATE sakes SET soldout_at=datetime('now','localtime') WHERE id=? AND (soldout_at IS NULL OR soldout_at='')", [sakeId]);
        if (!wasSoldout) becameSoldout = true; // 残数0で新たに売切になった＝日報の売切イベント対象
      } else {
        // 補充＝新しい瓶として鮮度クロックもリセット
        await run("UPDATE sakes SET status='available', soldout_at='', opened_at='' WHERE id=? AND status='soldout'", [sakeId]);
      }
    }
    await audit("sake.stock", { id: sakeId, stock: b.stock });
  }

  // 初心者おすすめ（「今日の3本」キュレーション）のトグル
  if (b.beginner !== undefined) {
    await run("UPDATE sakes SET is_beginner = ?, updated_at = datetime('now','localtime') WHERE id = ?", [
      b.beginner ? 1 : 0,
      sakeId,
    ]);
    await audit("sake.beginner", { id: sakeId, beginner: !!b.beginner });
  }

  // 熱燗可（1合徳利のみ）のトグル。注文APIはこのフラグをサーバー側でも最終検証する
  if (b.kanOk !== undefined) {
    await run("UPDATE sakes SET kan_ok = ?, updated_at = datetime('now','localtime') WHERE id = ?", [
      b.kanOk ? 1 : 0,
      sakeId,
    ]);
    await audit("sake.kan_ok", { id: sakeId, kanOk: !!b.kanOk });
  }

  // 鮮度枠（開けたて・お早めに）の手動上書き。null=自動判定に戻す / true=必ず出す / false=出さない
  if (b.fresh !== undefined) {
    if (b.fresh === null) {
      await run("UPDATE sakes SET fresh_flag = NULL, updated_at = datetime('now','localtime') WHERE id = ?", [sakeId]);
    } else {
      await run("UPDATE sakes SET fresh_flag = ?, updated_at = datetime('now','localtime') WHERE id = ?", [b.fresh ? 1 : 0, sakeId]);
    }
    await audit("sake.fresh", { id: sakeId, fresh: b.fresh });
  }

  // 写真の差し替え（白背景で撮り直し）。データ項目はそのまま、画像だけ更新
  if (b.photo_base64) {
    const photo = Buffer.from(b.photo_base64, "base64");
    if (photo.length > 1_500_000) return NextResponse.json({ error: "写真が大きすぎます" }, { status: 400 });
    // CDN(Blob)へ（あれば）。失敗時は photo_url='' でDBのBLOB配信にフォールバック。
    let purl = "";
    if (blobAvailable()) {
      try { purl = await putImage(`photos/${sakeId}.jpg`, photo, b.photo_type || "image/jpeg"); } catch {}
    }
    await run("UPDATE sakes SET photo = ?, photo_type = ?, photo_url = ?, updated_at = datetime('now','localtime') WHERE id = ?", [
      photo,
      b.photo_type || "image/jpeg",
      purl,
      sakeId,
    ]);
    await audit("sake.photo.replace", { id: sakeId });
  }

  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status as (typeof STATUSES)[number])) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    await run("UPDATE sakes SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?", [
      b.status,
      sakeId,
    ]);
    // 売切れにしたら売切日を記録（初回のみ）。売切れ解除なら消す＝消化日数データ用。
    // 開栓日も連動リセット（売切＝瓶終了／提供中へ戻す＝新しい瓶）＝生酒の鮮度クロックを正しく保つ
    if (b.status === "soldout") {
      await run("UPDATE sakes SET soldout_at = datetime('now','localtime') WHERE id = ? AND (soldout_at IS NULL OR soldout_at = '')", [sakeId]);
      await run("UPDATE sakes SET opened_at = '' WHERE id = ?", [sakeId]);
      if (!wasSoldout) becameSoldout = true; // 手動で新たに売切にした＝日報の売切イベント対象
    } else {
      await run("UPDATE sakes SET soldout_at = '', opened_at = '' WHERE id = ?", [sakeId]);
    }
    await audit("sake.status", { id: sakeId, status: b.status });
  }
  if (b.archived === true) {
    await run("UPDATE sakes SET archived = 1, updated_at = datetime('now','localtime') WHERE id = ?", [sakeId]);
    await audit("sake.archive", { id: sakeId });
  } else if (b.archived === false) {
    // 削除した日本酒を復元（在庫ボードに戻す。状態は提供中へ）
    await run("UPDATE sakes SET archived = 0, status = 'available', updated_at = datetime('now','localtime') WHERE id = ?", [sakeId]);
    await audit("sake.restore", { id: sakeId });
  }
  // 提供中→売切 になった時だけ売切イベントを記録（soldout_at 設定後に呼ぶ。LINEは送らず夜の日報がまとめる）
  if (becameSoldout) await recordSoldoutEvent(sakeId);
  // 客向けページ（キャッシュ）を即時更新
  revalidatePath("/");
  revalidatePath("/zukan");
  revalidatePath(`/sake/${sakeId}`);
  return NextResponse.json({ ok: true });
}
