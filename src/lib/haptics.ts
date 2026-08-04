// 軽いハプティック（対応端末のみ＝Android Chrome等。iOS Safari は無反応だが無害）。
// ゲーム的な“手応え”をボタンや獲得演出に添えるための共通ユーティリティ。
export function haptic(pattern: number | number[] = 12): void {
  try {
    (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.(pattern);
  } catch {
    // 非対応は無視
  }
}
