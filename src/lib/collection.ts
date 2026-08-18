"use client";

import { useCallback, useEffect, useState } from "react";

// 図鑑エントリ: 杯数(count)と最初に飲んだ日(date)
export type TastedEntry = { count: number; date: string };

// 2モード: 匿名(localStorage) / LINEログイン(サーバー保存)
const TASTED_V3 = "sksl.tasted.v3"; // {sakeId: {c, d}}
const TASTED_V2 = "sksl.tasted.v2"; // 旧: {sakeId: date}
const TASTED_V1 = "sksl.tasted.v1"; // 旧: [sakeId]

export type Member = { name: string; picture: string; onRanking?: boolean; slug?: string } | null;
// 隠し酒プレゼントの引換コード（サーバー発行）。sake_id>0 ＝お客様が酒神を選んで図鑑に迎え済み。
export type RewardInfo = { id: number; reason: string; code: string; status: string; sake_id?: number; sake_brand?: string; god_name?: string };
// 神おろし演出に渡す、引換で迎えた隠し酒の酒神データ
export type ClaimedGod = { sakeId: number; brand: string; godName: string; rarity: string; hasArt: boolean; godUpdated: string };

export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 匿名（LINE未登録）ランキング参加用：端末ごとの安定ID＋表示名（任意）
const GUEST_ID_KEY = "sksl.guest.id";
const GUEST_NAME_KEY = "sksl.guest.name";
export function guestId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    id = "g_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { localStorage.setItem(GUEST_ID_KEY, id); } catch {}
  }
  return id;
}
export function guestName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(GUEST_NAME_KEY) || "";
}
export function setGuestName(name: string) {
  try { localStorage.setItem(GUEST_NAME_KEY, name); } catch {}
}

function readLocalTasted(): Map<number, TastedEntry> {
  try {
    const v3 = localStorage.getItem(TASTED_V3);
    if (v3) {
      const o = JSON.parse(v3) as Record<string, { c: number; d: string }>;
      return new Map(Object.entries(o).map(([k, v]) => [Number(k), { count: Number(v.c) || 1, date: String(v.d || "") }]));
    }
    const v2 = localStorage.getItem(TASTED_V2);
    if (v2) {
      const m = new Map<number, TastedEntry>(
        Object.entries(JSON.parse(v2) as Record<string, string>).map(([k, d]) => [Number(k), { count: 1, date: String(d || "") }])
      );
      writeLocalTasted(m);
      return m;
    }
    const v1 = localStorage.getItem(TASTED_V1);
    if (v1) {
      const m = new Map<number, TastedEntry>((JSON.parse(v1) as number[]).map((id) => [Number(id), { count: 1, date: "" }]));
      writeLocalTasted(m);
      return m;
    }
  } catch {}
  return new Map();
}
function writeLocalTasted(m: Map<number, TastedEntry>) {
  try {
    localStorage.setItem(TASTED_V3, JSON.stringify(Object.fromEntries([...m].map(([k, v]) => [k, { c: v.count, d: v.date }]))));
  } catch {}
}

export function useCollection() {
  const [tasted, setTasted] = useState<Map<number, TastedEntry>>(new Map());
  const [member, setMember] = useState<Member>(null);
  const [rewards, setRewards] = useState<RewardInfo[]>([]);
  const [avatarSakeId, setAvatarSakeId] = useState<number>(0); // アイコンに選んだ酒神(0=既定の位アイコン)
  const [ready, setReady] = useState(false);

  // 引換コードを取り直す（注文で新たに発行された分を反映するため）
  const reloadRewards = useCallback(async () => {
    try {
      const r = await fetch("/api/collection", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { rewards?: RewardInfo[] };
        setRewards(j.rewards || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    const toMap = (o?: Record<string, { count: number; date: string }>) =>
      new Map<number, TastedEntry>(Object.entries(o ?? {}).map(([k, v]) => [Number(k), { count: Number(v.count) || 1, date: String(v.date || "") }]));
    // まず端末バックアップから即描画＝ランク/図鑑がネット往復を待たずに出る。
    // サーバー応答後に上書き（サーバーが正）。これで「アカウントステータスが遅い」を解消。
    const local = readLocalTasted();
    if (local.size) setTasted(local);
    setReady(true);
    (async () => {
      let m: Member = null;
      let serverTasted = new Map<number, TastedEntry>();
      let serverRewards: RewardInfo[] = [];
      let serverAvatar = 0;
      try {
        const res = await fetch("/api/collection", { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as { member: Member; tasted?: Record<string, { count: number; date: string }>; rewards?: RewardInfo[]; avatarSakeId?: number };
          if (j.member) m = j.member;
          serverTasted = toMap(j.tasted);
          serverRewards = j.rewards || [];
          serverAvatar = Number(j.avatarSakeId) || 0;
        }
      } catch {}

      if (m) {
        // 会員：welcomeのときだけ端末を統合
        let finalT = serverTasted;
        if (new URLSearchParams(location.search).get("welcome") === "1" && local.size) {
          try {
            await fetch("/api/collection/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tasted: Object.fromEntries([...local].map(([k, v]) => [k, { count: v.count, date: v.date }])) }),
            });
            finalT = toMap((await (await fetch("/api/collection", { cache: "no-store" })).json()).tasted);
          } catch {}
        }
        if (!cancelled) { setMember(m); setTasted(finalT); }
      } else {
        // 匿名：サーバー（ゲストCookie）を正に。端末にしか無い分はサーバーへ統合＝LINE無しでも残る
        const localOnly = [...local].filter(([id]) => !serverTasted.has(id));
        if (localOnly.length) {
          try {
            await fetch("/api/collection/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tasted: Object.fromEntries(localOnly.map(([k, v]) => [k, { count: v.count, date: v.date }])) }),
            });
          } catch {}
          localOnly.forEach(([id, v]) => serverTasted.set(id, v));
        }
        writeLocalTasted(serverTasted); // 端末も最新化（バックアップ）
        if (!cancelled) { setMember(null); setTasted(serverTasted); }
      }
      if (!cancelled) { setRewards(serverRewards); setAvatarSakeId(serverAvatar); setReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  const loggedIn = !!member;

  // アイコン（プロフィール画像）を集めた酒神から選ぶ。0で既定（位アイコン）に戻す。会員/ゲスト両対応（Cookieで識別）。
  const setAvatar = useCallback((sakeId: number) => {
    const aid = Math.max(0, Math.floor(sakeId) || 0);
    setAvatarSakeId(aid);
    fetch("/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "avatar", sakeId: aid }),
    }).catch(() => {});
  }, []);

  // サーバーへ反映（会員→member_tasted / 匿名→guest_tasted。Cookieで識別）＋匿名は端末にもバックアップ
  const persist = useCallback(
    (body: object, next: Map<number, TastedEntry>) => {
      fetch("/api/collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
      if (!loggedIn) writeLocalTasted(next);
    },
    [loggedIn]
  );

  // 図鑑に登録/解除（種類）
  const toggleTasted = useCallback((id: number) => {
    setTasted((prev) => {
      const next = new Map(prev);
      const has = next.has(id);
      if (has) next.delete(id);
      else next.set(id, { count: 1, date: todayISO() });
      persist({ action: "tasted", sakeId: id, value: !has, date: todayISO() }, next);
      return next;
    });
  }, [persist]);

  // 注文・登録時の図鑑追加：図鑑に無ければ1回だけ登録、あれば何もしない（重複なし）
  const markTasted = useCallback((id: number) => {
    setTasted((prev) => {
      if (prev.has(id)) return prev;
      const next = new Map(prev);
      next.set(id, { count: 1, date: todayISO() });
      persist({ action: "tasted", sakeId: id, value: true, date: todayISO() }, next);
      return next;
    });
  }, [persist]);

  // もう一杯飲んだ：杯数(count)を qty ぶん加算（図鑑に無ければ登録）
  const drinkAgain = useCallback((id: number, qty = 1) => {
    const n = Math.max(1, Math.floor(qty));
    setTasted((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      next.set(id, { count: (cur?.count || 0) + n, date: cur?.date || todayISO() });
      persist({ action: "drink", sakeId: id, qty: n, date: todayISO() }, next);
      return next;
    });
  }, [persist]);

  // 隠し酒プレゼントの客側引換：選んだ隠し酒の酒神を図鑑に迎える。
  // 成功したら端末の図鑑(tasted)に即反映＋引換コード一覧を取り直し、演出用の酒神データを返す。
  const claimHiddenGod = useCallback(
    async (grantId: number, sakeId: number): Promise<{ ok: true; god: ClaimedGod } | { ok: false; error: string }> => {
      try {
        const res = await fetch("/api/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "claim-god", grantId, sakeId, date: todayISO() }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; god?: ClaimedGod; error?: string };
        if (!res.ok || !j.ok || !j.god) return { ok: false, error: j.error || "failed" };
        // 図鑑に即反映（サーバーはmarkTasted済み・ゲストは端末バックアップも更新）
        setTasted((prev) => {
          if (prev.has(sakeId)) return prev;
          const next = new Map(prev);
          next.set(sakeId, { count: 1, date: todayISO() });
          if (!loggedIn) writeLocalTasted(next);
          return next;
        });
        // 引換コードの sake_id を反映（迎え済みに切り替わる）
        setRewards((prev) => prev.map((r) => (r.id === grantId ? { ...r, sake_id: sakeId, sake_brand: j.god!.brand, god_name: j.god!.godName } : r)));
        void reloadRewards();
        return { ok: true, god: j.god };
      } catch {
        return { ok: false, error: "network" };
      }
    },
    [loggedIn, reloadRewards]
  );

  // ランキング表示名の変更（任意）。会員はサーバー(members.nickname)、ゲストは端末に保存
  const changeName = useCallback(
    async (name: string) => {
      const n = name.trim().slice(0, 12);
      if (loggedIn) {
        setMember((m) => (m ? { ...m, name: n } : m));
        try {
          await fetch("/api/collection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "name", name: n }),
          });
        } catch {}
      } else {
        setGuestName(n); // 端末キャッシュ
        try {
          // サーバー（ゲストCookie）にも保存＝端末が消えてもランキング名が残る
          await fetch("/api/ranking/guest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: n }),
          });
        } catch {}
      }
    },
    [loggedIn]
  );

  return { tasted, ready, member, loggedIn, rewards, reloadRewards, claimHiddenGod, toggleTasted, markTasted, drinkAgain, changeName, avatarSakeId, setAvatar };
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  if (!m || !d) return "";
  return `${Number(m)}月${Number(d)}日`;
}

// ===== 位（くらい）：集めた種類数で昇格【2026-06-18 種類ベース＝注文で図鑑登録・同じ酒は1回・杯数は数えない】 =====
// 引数は「集めた種類数」。違う日本酒を集めるほど位が上がり、200種で殿堂入り（以降ランク固定で図鑑だけ増える）。
// 30種ごとに隠し酒プレゼントのマイルストーン（2026-08-18 オーナー指示で50種ごと→30種ごと）。
// お店の酒は入れ替わるので通えば200種も到達可能。
export const HALL_OF_FAME = 200; // この種類数で殿堂入り（最高位・以降ランクは上がらない）
export const REWARD_STEP = 30; // 何種ごとに隠し酒プレゼントか
export const REWARD_MILESTONES = [30, 60, 90, 120, 150, 180]; // 隠し酒プレゼントの節目（種類数・rewards.tsのサーバー定義と一致させる）

export type Rank = { min: number; name: string; sub: string; icon: string; nameEn: string; subEn: string };

export const RANKS: Rank[] = [
  { min: 0, name: "一見さん", sub: "ようこそ酒コレへ", icon: "🚪", nameEn: "First Visit", subEn: "Welcome to your collection" },
  { min: 1, name: "はじめの一杯", sub: "図鑑の旅、開始", icon: "🍶", nameEn: "First Pour", subEn: "Your journey begins" },
  { min: 5, name: "利き酒見習い", sub: "舌が目覚めてきた", icon: "🔰", nameEn: "Tasting Apprentice", subEn: "Your palate awakens" },
  { min: 12, name: "利き酒人", sub: "好みが見えてきた", icon: "👀", nameEn: "Taster", subEn: "Finding your taste" },
  { min: 25, name: "酒通", sub: "通を名乗れる", icon: "😋", nameEn: "Connoisseur", subEn: "A true connoisseur" },
  { min: 45, name: "利き酒師", sub: "違いがわかる", icon: "🎓", nameEn: "Sake Sommelier", subEn: "You know the difference" },
  { min: 70, name: "蔵人", sub: "蔵の一員レベル", icon: "⚒️", nameEn: "Brewery Hand", subEn: "Brewery-crew level" },
  { min: 100, name: "杜氏", sub: "極めの域", icon: "🏯", nameEn: "Toji (Master Brewer)", subEn: "Mastery" },
  { min: 140, name: "酒仙", sub: "酒の仙人", icon: "🧙", nameEn: "Sake Sage", subEn: "Sage of sake" },
  { min: 170, name: "日本酒マスター", sub: "頂点目前", icon: "👑", nameEn: "Sake Master", subEn: "Near the summit" },
  { min: HALL_OF_FAME, name: "殿堂入り", sub: "レジェンド・図鑑は増え続ける", icon: "🏆", nameEn: "Hall of Fame", subEn: "Legend — your library keeps growing" },
];

// 延べ杯数（飲んだ杯の合計）
export function totalCups(tasted: Map<number, TastedEntry>): number {
  let n = 0;
  for (const v of tasted.values()) n += v.count || 0;
  return n;
}

export function rankIndexFor(cups: number): number {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (cups >= RANKS[i].min) idx = i;
  return idx;
}
export function rankFor(cups: number): Rank {
  return RANKS[rankIndexFor(cups)];
}
export function nextRank(cups: number): { rank: Rank; remaining: number } | null {
  const idx = rankIndexFor(cups);
  const nx = RANKS[idx + 1];
  return nx ? { rank: nx, remaining: nx.min - cups } : null;
}
export function currentRank(cups: number): string {
  return rankFor(cups).name;
}

// 位ごとのテーマ配色（上がるほど高級感：緑→ブロンズ→金→漆黒×金→シャンパンゴールド）。
// from/to=カードのグラデ、accent=進捗バー/強調、glow=縁のほのかな輝き。RANKSと同じ並び。
export type RankTheme = { from: string; to: string; accent: string };
export const RANK_THEMES: RankTheme[] = [
  { from: "#4e5b54", to: "#333d38", accent: "#cdd6d0" }, // 一見さん：くすんだ石・シルバー
  { from: "#3f7a5a", to: "#275339", accent: "#bfe6cf" }, // はじめの一杯：若草
  { from: "#357056", to: "#1f4d39", accent: "#a9dcc0" }, // 利き酒見習い：苔緑
  { from: "#2a5e46", to: "#163a2c", accent: "#9fd4b4" }, // 利き酒人：深緑
  { from: "#234f3c", to: "#0f2c20", accent: "#c9a16b" }, // 酒通：深緑×ブロンズ
  { from: "#1f4636", to: "#0e2a20", accent: "#cda978" }, // 利き酒師：森×銅
  { from: "#1b3d2f", to: "#0b231a", accent: "#d4b277" }, // 蔵人：濃緑×アンティーク金
  { from: "#182e26", to: "#0a1812", accent: "#e0c07f" }, // 杜氏：墨緑×金
  { from: "#2a2438", to: "#140f1f", accent: "#e3c47f" }, // 酒仙：深い宝石（紫）×金
  { from: "#20201c", to: "#0c0c0a", accent: "#ecd08f" }, // 日本酒マスター：漆黒×輝く金
  { from: "#241c10", to: "#070503", accent: "#f0dca0" }, // 殿堂入り：黒×シャンパンゴールド
];
export function rankThemeFor(cups: number): RankTheme {
  return RANK_THEMES[rankIndexFor(cups)];
}
export function isHallOfFame(cups: number): boolean {
  return cups >= HALL_OF_FAME;
}
// これまでに獲得した隠し酒プレゼントの数（0〜節目の総数）
export function rewardsEarned(cups: number): number {
  return Math.min(Math.floor(cups / REWARD_STEP), REWARD_MILESTONES.length);
}
// 次の隠し酒プレゼントまで（最終節目を超えたら null＝コンプリート）
export function nextReward(cups: number): { target: number; remaining: number } | null {
  const target = Math.floor(cups / REWARD_STEP) * REWARD_STEP + REWARD_STEP;
  if (target > REWARD_MILESTONES[REWARD_MILESTONES.length - 1]) return null;
  return { target, remaining: target - cups };
}
