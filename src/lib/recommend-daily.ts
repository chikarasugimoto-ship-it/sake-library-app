// 「本日のおすすめ」を1日1回だけ決めて固定する（日中は変わらない・営業後の集計で翌営業日ぶんに切替）。
// 生酒に偏らないよう、生酒・季節・プレミアム・初心者・定番をバランスよく混ぜ、日替わりでローテーションする。
import { get, run } from "./db";
import type { Sake } from "./types";

// その日の「おすすめ」へ切り替わる時刻（JST）。閉店後〜早朝に切り替わるよう 5時に設定。
// ＝深夜営業中は前日のセットのまま（同じ営業日）、明け方に翌営業日ぶんへ更新される。
const ROLL_HOUR_JST = 5;
const PICK_N = 6;

// 営業日（5時始まり・JST）の日付キーと、ローテーション用の連番シードを返す。
export function businessDay(now: number): { date: string; seed: number } {
  const shifted = now + 9 * 3_600_000 - ROLL_HOUR_JST * 3_600_000; // JST化 → ロール時刻ぶん戻す
  const d = new Date(shifted);
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const seed = Math.floor(shifted / 86_400_000); // 1日ごとに+1（曜日ではなく通日）
  return { date, seed };
}

// offset ぶん先頭をずらした配列（決定的なローテーション）。
function rotate<T>(arr: T[], offset: number): T[] {
  if (arr.length <= 1) return arr.slice();
  const k = ((Math.trunc(offset) % arr.length) + arr.length) % arr.length;
  return arr.slice(k).concat(arr.slice(0, k));
}

// 提供中・写真あり・非表示でない酒だけを対象に。
function liveSakes(sakes: Sake[]): Sake[] {
  return sakes.filter((s) => s.status !== "soldout" && !s.isHidden && s.hasPhoto);
}

// その日の「おすすめ」6本を決める（決定的＝同じ seed/在庫なら同じ結果）。
// 各酒は重複しない1バケットに割り当て、上限つきで混ぜる＝生酒だらけにならない。
export function pickDailyRecommend(sakes: Sake[], seed: number, n = PICK_N): number[] {
  const live = liveSakes(sakes);
  if (live.length <= n) return rotate(live, seed).map((s) => s.id); // 少なければ全部（並びだけ日替わり）

  // 優先順位でバケットへ重複なく分類（生酒は最優先で拾い、上限で抑える）
  const fresh = rotate(live.filter((s) => s.freshSensitive), seed);
  const seasonal = rotate(live.filter((s) => !s.freshSensitive && s.seasonLabel), seed);
  const premium = rotate(live.filter((s) => !s.freshSensitive && !s.seasonLabel && s.isPremium), seed);
  const beginner = rotate(live.filter((s) => !s.freshSensitive && !s.seasonLabel && !s.isPremium && s.isBeginner), seed);
  const standard = rotate(live.filter((s) => !s.freshSensitive && !s.seasonLabel && !s.isPremium && !s.isBeginner), seed);

  // 構成（上限）。生酒は最大2本までにしてバランスを取る。
  const plan: [Sake[], number][] = [
    [fresh, 2],
    [seasonal, 1],
    [premium, 1],
    [beginner, 1],
    [standard, 1],
  ];
  const used = new Set<number>();
  const pick: number[] = [];
  const pull = (arr: Sake[], cap: number) => {
    let k = cap;
    for (const s of arr) {
      if (pick.length >= n || k <= 0) break;
      if (used.has(s.id)) continue;
      used.add(s.id);
      pick.push(s.id);
      k--;
    }
  };
  for (const [arr, cap] of plan) pull(arr, cap);
  // 6本に満たなければ、全体（残り）から補充して埋める
  if (pick.length < n) pull(rotate(live, seed).filter((s) => !used.has(s.id)), n - pick.length);

  return rotate(pick, seed); // 並びも日替わりで（先頭の一本が毎日変わる）
}

// 「本日のおすすめ」の確定IDを返す。営業日が変わっていれば作り直して保存、同じ日なら保存済みを返す。
// ＝日中は固定、営業後（早朝のロール時刻）以降に初めて開かれた時に翌営業日ぶんへ更新。
export async function getDailyRecommendIds(sakes: Sake[], now: number): Promise<number[]> {
  const { date, seed } = businessDay(now);
  const liveIds = new Set(liveSakes(sakes).map((s) => s.id));

  let stored: { date?: string; ids?: number[] } = {};
  try {
    const row = await get<{ value: string }>("SELECT value FROM settings WHERE key = 'daily_recommend'");
    if (row?.value) stored = JSON.parse(row.value);
  } catch {
    // 壊れていれば作り直す
  }

  if (stored.date === date && Array.isArray(stored.ids) && stored.ids.length) {
    // その日の確定セット。日中に売切れた等で消えたものだけ除外して返す（順番は保つ）。
    const kept = stored.ids.filter((id) => liveIds.has(id));
    if (kept.length) return kept;
    // 全部消えていたらフォールバックで作り直す
  }

  const ids = pickDailyRecommend(sakes, seed);
  // ビルド時（静的プリレンダリング）はDB書き込みをしない＝デプロイ毎の余計な書込みを避ける。
  // 実リクエスト時に保存されるので、日中の固定・営業日の切替には影響しない。
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    try {
      await run(
        "INSERT INTO settings (key, value) VALUES ('daily_recommend', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [JSON.stringify({ date, ids })]
      );
    } catch {
      // 保存に失敗しても、その場の決定的な結果を返せば表示は成立する
    }
  }
  return ids;
}
