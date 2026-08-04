"use client";

import { useSyncExternalStore } from "react";

// 言語の共有ストア（全 <T> が購読）。表示中の言語だけ描画し、切替で全体が即入れ替わる。
const KEY = "sksl.lang";
export type Lang = "ja" | "en";

let lang: Lang = "ja";
if (typeof window !== "undefined") {
  try {
    if (localStorage.getItem(KEY) === "en") lang = "en";
  } catch {}
}

const subs = new Set<() => void>();
function subscribe(f: () => void) {
  subs.add(f);
  return () => subs.delete(f);
}
function getSnapshot(): Lang {
  return lang;
}
function getServerSnapshot(): Lang {
  return "ja"; // SSR は日本語（既定）。クライアントで en ならハイドレーション後に切替。
}

export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {}
  subs.forEach((f) => f());
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
