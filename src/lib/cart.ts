"use client";

// 日本酒の注文カート。全画面で共有する軽量ストア（localStorage 永続）。
import { useSyncExternalStore } from "react";

export type CartItem = { id: number; brand: string; grade?: string; price: number | null; volume?: string };
type Line = { item: CartItem; qty: number };

const KEY = "sksl.cart.v1";
const EMPTY: Record<number, Line> = {};

let lines: Record<number, Line> = loadInitial();
const listeners = new Set<() => void>();

function loadInitial(): Record<number, Line> {
  if (typeof window === "undefined") return EMPTY;
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<number, Line>;
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
  const cur = lines[item.id];
  lines = { ...lines, [item.id]: { item, qty: (cur?.qty || 0) + qty } };
  persist();
}
export function setQty(id: number, qty: number) {
  if (qty <= 0) {
    const rest = { ...lines };
    delete rest[id];
    lines = rest;
  } else if (lines[id]) {
    lines = { ...lines, [id]: { ...lines[id], qty } };
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
  const list = Object.values(state);
  const count = list.reduce((n, l) => n + l.qty, 0);
  const total = list.reduce((n, l) => n + (l.item.price || 0) * l.qty, 0);
  return { lines: list, count, total };
}
