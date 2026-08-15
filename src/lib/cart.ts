"use client";

// 日本酒の注文カート。全画面で共有する軽量ストア（localStorage 永続）。
// 2026-08-16 サイズ対応（グラス/1合/熱燗）: 行キーを `${id}:${size}` にし、保存キーを v2 に版上げ。
// v1（sizeなし）は読まない＝旧カートは静かに破棄（size不明のまま注文させない）。
import { useSyncExternalStore } from "react";
import { type SakeSize, CUPS, priceFor } from "./sizes";

export type { SakeSize };

// サイズを決める前の銘柄情報（一覧カード・詳細ページ・AIおすすめが渡す形）
export type CartSake = { id: number; brand: string; grade?: string; price: number | null; volume?: string };
// カートの1行に入る実体。price は「グラス(90ml)の基準価格」のまま持ち、表示・合計は priceFor で換算する
export type CartItem = CartSake & { size: SakeSize };
type Line = { item: CartItem; qty: number };

const KEY = "sksl.cart.v2";
const EMPTY: Record<string, Line> = {};

// 行キー（同じ銘柄でもサイズ違いは別行）
export function cartKey(id: number, size: SakeSize): string {
  return `${id}:${size}`;
}

let lines: Record<string, Line> = loadInitial();
const listeners = new Set<() => void>();

function loadInitial(): Record<string, Line> {
  if (typeof window === "undefined") return EMPTY;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, Line>;
    // 念のため形を検証（size の無い行・壊れた行は捨てる）
    const ok: Record<string, Line> = {};
    for (const [k, l] of Object.entries(parsed)) {
      if (l && l.item && typeof l.item.id === "number" && (l.item.size === "glass" || l.item.size === "go" || l.item.size === "kan") && l.qty > 0) {
        ok[k] = l;
      }
    }
    return ok;
  } catch {
    return {};
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {}
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function addToCart(item: CartItem, qty = 1) {
  const key = cartKey(item.id, item.size);
  const cur = lines[key];
  lines = { ...lines, [key]: { item, qty: (cur?.qty || 0) + qty } };
  persist();
}
export function setQty(key: string, qty: number) {
  if (qty <= 0) {
    const rest = { ...lines };
    delete rest[key];
    lines = rest;
  } else if (lines[key]) {
    lines = { ...lines, [key]: { ...lines[key], qty } };
  }
  persist();
}
export function clearCart() {
  lines = {};
  persist();
}

// 卓番号（QR /t/{卓} で cookie に保存。httpOnly でないのでクライアントから読める）
export function currentTable(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sksl_table=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

// 注文UIの表示可否（本番でフラグが立つまで一切出さない）
export function orderingUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ORDERING_ENABLED === "1";
}

export function useCart() {
  const state = useSyncExternalStore(subscribe, () => lines, () => EMPTY);
  const list = Object.entries(state).map(([key, l]) => ({ key, item: l.item, qty: l.qty }));
  // count＝90mlグラス換算の杯数（1合・熱燗は×2。「◯杯」表示と図鑑演出に使う）
  const count = list.reduce((n, l) => n + l.qty * CUPS[l.item.size], 0);
  // 合計金額はサイズ後の単価（1合・熱燗=グラス×2）で計算
  const total = list.reduce((n, l) => n + priceFor(l.item.price || 0, l.item.size) * l.qty, 0);
  return { lines: list, count, total };
}
