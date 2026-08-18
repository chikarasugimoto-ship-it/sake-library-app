"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  useCollection,
  nextRank,
  rankFor,
  rankIndexFor,
  rankThemeFor,
  RANKS,
  currentRank,
  formatDate,
  todayISO,
  isHallOfFame,
  nextReward,
  rewardsEarned,
  REWARD_MILESTONES,
  HALL_OF_FAME,
  guestName,
} from "@/lib/collection";
import { buildShareImage, type ShareData } from "@/lib/shareImage";
import { photoUrl } from "@/lib/types";
import type { SakeEn } from "@/lib/types";
import { T } from "@/components/T";
import { LangToggle } from "@/components/LangToggle";
import { BottleArt } from "@/components/BottleArt";
import { MascotSpeech } from "@/components/Mascot";
import { SakegamiReveal } from "@/components/SakegamiReveal";
import Image from "next/image";
import { RARITY_META, RARITIES, rarityRank, type Rarity, region8For, breweryKey, REGION8 } from "@/lib/sakegami";

// 酒神ランク（レア度）のやさしい説明
const RANK_DESC: Record<Rarity, { ja: string; en: string }> = {
  N: { ja: "定番の一杯", en: "Everyday pours" },
  R: { ja: "純米など蔵の個性", en: "Junmai & a brewery's character" },
  SR: { ja: "吟醸・季節限定の匠", en: "Ginjo & seasonal craft" },
  SSR: { ja: "大吟醸など雅な逸品", en: "Daiginjo & elegant gems" },
  UR: { ja: "入手困難な希少銘柄", en: "Rare, hard-to-get labels" },
  LR: { ja: "隠し酒など伝説級", en: "Secret, legendary sake" },
};

const STORE_NAME = "煮干しと日本酒 すぎだま";
const SHARE_URL = "sake-library-plum.vercel.app";
import { QuickAdd } from "../QuickAdd";

type Entry = {
  id: number;
  brand: string;
  brewery: string;
  prefecture: string;
  labelColor: string;
  hasPhoto: boolean;
  isPremium: boolean;
  grade: string;
  price: number | null;
  volume: string;
  status: "available" | "low" | "soldout";
  updatedAt: string;
  outOfCatalog?: boolean; // 現在のカタログに無い（集めたが提供終了）銘柄
  rarity?: string; // 酒神レア度（N〜LR・メタ生成済みのみ）
  godName?: string; // 酒神名
  hasArt?: boolean; // 酒神キャラ絵があるか（図鑑グリッドはキャラ優先表示）
  godUpdated?: string; // 酒神絵のキャッシュバージョン用
  en?: SakeEn | null; // 英語表示用（ページから渡される）
};

type Tab = "all" | "locked" | "history" | "ranking" | "conquest";
type RankRow = { rank: number; name: string; picture: string; kinds: number; avatar: number; isMe: boolean };
// 隠し酒プレゼントで選べる隠し酒（提供中）。zukan/page.tsx の listHiddenGods から渡る
type HiddenGod = { sakeId: number; brand: string; godName: string; rarity: string; hasArt: boolean; godUpdated: string };

export function Zukan({ entries, hiddenGods = [] }: { entries: Entry[]; hiddenGods?: HiddenGod[] }) {
  const { tasted, ready, member, loggedIn, rewards, claimHiddenGod, changeName, avatarSakeId, setAvatar } = useCollection();
  // 隠し酒の客側引換：選択中の grant / 引換処理中フラグ / 神おろし演出データ
  const [claimFor, setClaimFor] = useState<number | null>(null); // ピッカーを開いている grantId
  const [claiming, setClaiming] = useState(false);
  const [claimReveal, setClaimReveal] = useState<{ name: string; rarity: string; artUrl: string | null } | null>(null);
  const [claimError, setClaimError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false); // アイコン（酒神）選択モーダル
  const [tab, setTab] = useState<Tab>("all");
  const [share, setShare] = useState<{ url: string; file: File; caption: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [format, setFormat] = useState<"story" | "feed">("story");
  const shareBaseRef = useRef<ShareData | null>(null);
  const captionRef = useRef<string>("");
  const fetchedKeyRef = useRef<string>(""); // 直近で取得した「不足ID集合」＝同じなら再取得しない
  const [ranking, setRanking] = useState<RankRow[] | null>(null);
  const [myRank, setMyRank] = useState<RankRow | null>(null); // 上位10名圏外でも本人の順位を出す
  const [rankTotal, setRankTotal] = useState(0); // 参加人数
  // 集めたが現在のカタログに無い銘柄（削除/提供終了）を取り戻して図鑑に出し続ける
  const [extras, setExtras] = useState<Entry[]>([]);

  useEffect(() => {
    if (!ready) return;
    const have = new Set(entries.map((e) => e.id));
    const missing = [...tasted.keys()].filter((id) => !have.has(id));
    if (!missing.length) {
      fetchedKeyRef.current = "";
      setExtras((cur) => (cur.length ? [] : cur));
      return;
    }
    const key = missing.sort((a, b) => a - b).join(",");
    if (key === fetchedKeyRef.current) return; // 同じ不足集合は再取得しない（注文のたびの連打を防ぐ）
    let cancelled = false;
    (async () => {
      try {
        // 200件ずつ分割して全件取得＝集めた銘柄が何百種あっても図鑑に出し続ける（保存は無制限）
        const CHUNK = 200;
        const batches: number[][] = [];
        for (let i = 0; i < missing.length; i += CHUNK) batches.push(missing.slice(i, i + CHUNK));
        const results = await Promise.all(
          batches.map((b) =>
            fetch(`/api/sakes?ids=${b.join(",")}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("sakes " + r.status))))
          )
        );
        if (cancelled) return;
        const all = results.flatMap((j) => (j.sakes ?? []) as Entry[]);
        fetchedKeyRef.current = key;
        setExtras(all.map((s) => ({ ...s, outOfCatalog: true })));
      } catch {
        // 失敗時は前回のextrasを保持（集めた銘柄を図鑑から消さない）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, entries, tasted]);

  // カタログ＋集めた提供終了銘柄。図鑑の表示・集計はこれを使う
  const allEntries = useMemo(() => [...entries, ...extras], [entries, extras]);

  // 注文完了画面の「シェア」から来たとき（?share=1）は、図鑑を開いた瞬間にシェアプレビューを自動で開く。
  const autoShareRef = useRef(false);
  useEffect(() => {
    if (autoShareRef.current || !ready) return;
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("share") !== "1") return;
    autoShareRef.current = true;
    window.history.replaceState(null, "", "/zukan"); // リロードで再発火しないようURLを掃除
    makeShareImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // ランクの基準＝集めた種類数（注文で図鑑に登録・同じ酒は1回・杯数は数えない）
  const count = useMemo(() => allEntries.filter((e) => tasted.has(e.id)).length, [allEntries, tasted]); // 集めた種類数（図鑑コレクション＝ランクの基準）

  // レア度ごとに「集めた酒神」が何体か
  const rarityCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of allEntries) {
      if (tasted.has(e.id) && e.rarity) m[e.rarity] = (m[e.rarity] || 0) + 1;
    }
    return m;
  }, [allEntries, tasted]);

  // 制覇（8地方・蔵元）。産地/蔵元のメタが入っている銘柄だけ集計（未生成なら空＝何も出さない）。
  const conquest = useMemo(() => {
    const regionMap = new Map<string, { total: number; got: number }>();
    const breweryMap = new Map<string, { name: string; total: number; got: number }>();
    for (const e of allEntries) {
      const isGot = tasted.has(e.id);
      const region = region8For(e.prefecture);
      if (region) {
        const r = regionMap.get(region) || { total: 0, got: 0 };
        r.total++; if (isGot) r.got++;
        regionMap.set(region, r);
      }
      const bk = breweryKey(e.brewery);
      if (bk) {
        const b = breweryMap.get(bk) || { name: e.brewery, total: 0, got: 0 };
        b.total++; if (isGot) b.got++;
        breweryMap.set(bk, b);
      }
    }
    const regions = REGION8.map((name) => ({ name, ...(regionMap.get(name) || { total: 0, got: 0 }) })).filter((r) => r.total > 0);
    const litRegions = regions.filter((r) => r.got >= Math.min(3, r.total) && r.got > 0).length;
    const breweries = [...breweryMap.values()]
      .sort((a, b) => {
        const ra = a.total - a.got, rb = b.total - b.got;
        const reachA = a.got > 0 && ra > 0 ? 0 : a.got >= a.total ? 2 : 1; // リーチ中(got>0,未完)を先頭、未着手を中、制覇を後ろ
        const reachB = b.got > 0 && rb > 0 ? 0 : b.got >= b.total ? 2 : 1;
        return reachA - reachB || ra - rb || b.got - a.got;
      });
    return { regions, litRegions, breweries, hasData: regions.length > 0 || breweries.length > 0 };
  }, [allEntries, tasted]);
  const next = nextRank(count);
  const rank = rankFor(count);
  const rankIdx = rankIndexFor(count);
  const theme = rankThemeFor(count); // 位ごとの高級感配色
  const pct = next ? Math.round(((count - rank.min) / (next.rank.min - rank.min)) * 100) : 100; // 次の位への進捗（種類数）
  const hof = isHallOfFame(count); // 殿堂入り
  const reward = nextReward(count); // 次の隠し酒プレゼントまで
  const earnedRewards = rewardsEarned(count); // 獲得済み隠し酒プレゼント数

  // 引換で選べる隠し酒＝提供中（page側で絞り込み済み）かつ「まだ図鑑に無い」もの
  const claimable = useMemo(() => hiddenGods.filter((h) => !tasted.has(h.sakeId)), [hiddenGods, tasted]);

  // 隠し酒を1つ選んで酒神を図鑑に迎える（本人確認→markTasted→神おろし演出）
  async function pickHiddenGod(grantId: number, h: HiddenGod) {
    if (claiming) return;
    setClaiming(true);
    setClaimError("");
    const r = await claimHiddenGod(grantId, h.sakeId);
    setClaiming(false);
    if (!r.ok) {
      // 在庫切れ・他端末で引換済み等＝候補が変わった可能性。文言で促す
      setClaimError(r.error === "already_owned" ? "owned" : r.error === "not_eligible" ? "gone" : "failed");
      return;
    }
    setClaimFor(null);
    const g = r.god;
    const art = g.hasArt ? `/api/god-art/${g.sakeId}?v=${(g.godUpdated || "").replace(/\D/g, "").slice(0, 14) || "0"}` : null;
    setClaimReveal({ name: g.godName || g.brand, rarity: g.rarity, artUrl: art });
  }

  // アイコン（プロフィール画像）＝選んだ酒神。未選択(0)は位アイコンの絵文字。
  const avatarEntry = avatarSakeId ? allEntries.find((e) => e.id === avatarSakeId) : null;
  const avatarUrl = avatarSakeId ? `/api/god-art/${avatarSakeId}?v=${(avatarEntry?.godUpdated || "").replace(/\D/g, "").slice(0, 14) || "0"}` : null;
  // ピッカー候補＝集めた酒神のうち絵があるもの
  const avatarChoices = useMemo(() => allEntries.filter((e) => tasted.has(e.id) && e.hasArt), [allEntries, tasted]);

  // ランキングを開いたら取得。匿名でもゲストCookie＋注文の図鑑(guest_tasted)で自動参加。
  // 自分の行は isMe（Cookie/会員で判定）で色付け表示する。
  useEffect(() => {
    if (tab !== "ranking" || ranking !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/ranking");
        if (!r.ok) throw new Error("ranking " + r.status);
        const j = await r.json();
        if (!cancelled) { setRanking(j.ranking ?? []); setMyRank(j.me ?? null); setRankTotal(j.total ?? 0); }
      } catch {
        if (!cancelled) { setRanking([]); setMyRank(null); }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, ranking]);

  // ランキング表示名の変更（任意・LINE不要）。変更後は再取得
  function editName() {
    const myRow = myRank || ranking?.find((r) => r.isMe) || null;
    const cur = loggedIn ? member?.name || "" : myRow?.name && myRow.name !== "ゲスト" ? myRow.name : guestName();
    const v = window.prompt("ランキングに表示する名前（空欄でゲスト・12文字まで）", cur);
    if (v === null) return;
    changeName(v).then(() => setRanking(null));
  }

  // 飲んだ順（新しい順）の履歴
  const history = useMemo(
    () =>
      allEntries
        .filter((e) => tasted.has(e.id))
        .map((e) => ({ ...e, date: tasted.get(e.id)?.date || "", cnt: tasted.get(e.id)?.count || 1 }))
        .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : b.id - a.id)),
    [allEntries, tasted]
  );

  const visible = useMemo(() => {
    if (tab === "locked") return allEntries.filter((e) => !tasted.has(e.id));
    return allEntries;
  }, [allEntries, tab, tasted]);

  // 指定フォーマットでカード画像を作り、プレビューに反映（前の画像URLは破棄）
  async function renderShare(fmt: "story" | "feed") {
    const base = shareBaseRef.current;
    if (!base) return;
    const blob = await buildShareImage({ ...base, format: fmt });
    const file = new File([blob], `sugidama-sake-${fmt}.png`, { type: "image/png" });
    const url = URL.createObjectURL(blob);
    setShare((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { url, file, caption: captionRef.current };
    });
  }

  // シェア画像を作って「プレビュー」を開く（SNSに飛ぶ前に必ず確認できる）。既定はストーリー(9:16)
  async function makeShareImage() {
    setSharing(true);
    try {
      const today = todayISO();
      const todayEntries = history.filter((e) => e.date === today);
      const todayCount = todayEntries.length;
      const others = Math.max(0, todayCount - 1);
      // 主役＝今日獲得した中で最高レア度の酒神（キャラ絵あり）。なければ写真の一本。
      const gods = todayEntries
        .filter((e) => e.hasArt && e.rarity)
        .sort((a, b) => rarityRank(b.rarity as Rarity) - rarityRank(a.rarity as Rarity));
      const heroGod = gods[0] || null;
      const featured = todayEntries.find((e) => e.hasPhoto) || todayEntries[0] || history[0];
      const heroLabel = heroGod ? "獲得した酒神" : todayCount > 0 ? "本日の一献" : "図鑑の一本";
      const subLine = heroGod
        ? `${heroGod.brand}${todayCount > 1 ? ` ほか${others}本` : ""}`
        : todayCount > 1
        ? `ほか${others}本 ・ 本日${todayCount}本を図鑑に記録`
        : todayCount === 1
        ? "本日、図鑑に記録"
        : "これまでに記録した一本";
      const godMeta = heroGod ? RARITY_META[heroGod.rarity as Rarity] : null;
      shareBaseRef.current = {
        storeName: STORE_NAME,
        heroLabel,
        featuredName: heroGod ? heroGod.godName || heroGod.brand : featured ? featured.brand : "—",
        featuredColor: featured?.labelColor || "#2f5a43",
        featuredPhotoUrl: featured?.hasPhoto ? `${location.origin}${photoUrl(featured.id, featured.updatedAt)}` : undefined,
        subLine,
        collectedKinds: count,
        rankName: currentRank(count),
        url: SHARE_URL,
        godArtUrl: heroGod
          ? `${location.origin}/api/god-art/${heroGod.id}?v=${(heroGod.godUpdated || "").replace(/\D/g, "").slice(0, 14) || "0"}`
          : undefined,
        godRarityLabel: heroGod && godMeta ? `${heroGod.rarity}・${godMeta.jp}` : undefined,
        godFrameColor: godMeta?.color,
      };
      captionRef.current = heroGod
        ? `飲んだ日本酒が、酒神になる。\n` +
          `${heroGod.brand}の酒神「${heroGod.godName || heroGod.brand}」を獲得！🐉\n` +
          `わたしの図鑑コレクションは${count}種に🍶\n` +
          `煮干しと日本酒 すぎだま（東京・常盤橋）\n` +
          `https://${SHARE_URL}\n` +
          `#すぎだま #日本酒図鑑 #酒神図鑑 #日本酒好きと繋がりたい`
        : `飲んだ日本酒が、図鑑になる。\n` +
          `${todayCount > 0 ? `本日${todayCount}本、` : ""}わたしの図鑑コレクションは${count}種に🍶\n` +
          `煮干しと日本酒 すぎだま（東京・常盤橋）\n` +
          `https://${SHARE_URL}\n` +
          `#すぎだま #日本酒図鑑 #日本酒好きと繋がりたい #日本酒のある暮らし`;
      setFormat("story");
      await renderShare("story");
    } catch {
      // 生成失敗は無視
    }
    setSharing(false);
  }

  // ストーリー(9:16) ⇄ フィード(4:5) の切替
  async function switchFormat(fmt: "story" | "feed") {
    if (fmt === format || regenerating) return;
    setFormat(fmt);
    setRegenerating(true);
    await renderShare(fmt);
    setRegenerating(false);
  }

  function closeShare() {
    if (share) URL.revokeObjectURL(share.url);
    setShare(null);
  }
  function saveImage() {
    if (!share) return;
    const a = document.createElement("a");
    a.href = share.url;
    a.download = `sugidama-sake-${format}.png`;
    a.click();
  }
  async function nativeShare() {
    if (!share) return;
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    try {
      if (nav.canShare && nav.canShare({ files: [share.file] })) {
        // 画像のみを共有（説明文・URLは渡さない＝ストーリーズ等に画像だけが出る）。
        await navigator.share({ files: [share.file] });
      } else {
        saveImage();
      }
    } catch {
      // 共有キャンセルは無視
    }
  }
  // X：画像だけを投稿（説明文・リンクは付けない）。共有シートがあれば画像のみ共有→Xを選ぶと画像が添付。
  // 無い環境（PC等）は画像を保存＋Xの投稿画面（空）を開く＝保存した画像を手動添付。
  async function openX() {
    if (!share) return;
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare && nav.canShare({ files: [share.file] })) {
      await nativeShare();
    } else {
      saveImage();
      window.open("https://twitter.com/intent/tweet", "_blank");
    }
  }
  function openLine() {
    if (share) window.open(`https://line.me/R/msg/text/?${encodeURIComponent(share.caption)}`, "_blank");
  }
  // Instagram：画像だけを出す（説明文なし）。共有シートがあれば画像のみ共有→無ければ保存。
  async function openInstagram() {
    if (!share) return;
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare && nav.canShare({ files: [share.file] })) {
      await nativeShare();
    } else {
      saveImage();
      alert(
        format === "story"
          ? "画像を保存しました。Instagramの「ストーリーズ」で保存した画像を選んで投稿してください。"
          : "画像を保存しました。Instagramを開いて保存した画像を投稿してください。"
      );
    }
  }

  return (
    <>
      {/* 進捗ヘッダー */}
      <section className="px-6 pt-7">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-bold tracking-[0.3em] text-moss">あなたの酒コレ</p>
          <LangToggle />
        </div>
        {/* すぎだまるの挨拶（はじめたばかりの人へ・集めるほど静かに引っ込む） */}
        {count < 5 && (
          <MascotSpeech size={46} className="mt-3">
            <T ja="お帰りなさい。飲んだ一杯が、ここに宿っていきます。今宵は、どの神に会いに？" en="Welcome back. Every sake you drink dwells here. Which god will you meet tonight?" />
          </MascotSpeech>
        )}
        {/* ランク・ヒーロー（延べ杯数で昇格・ゲーム感覚。位が上がるほど高級感が増す配色） */}
        <div
          className="relative mt-2 overflow-hidden rounded-2xl p-4 text-white transition-colors duration-700"
          style={{
            background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`,
            boxShadow: `0 16px 34px rgba(0,0,0,0.42), inset 0 0 0 1.5px ${theme.accent}99, inset 0 0 0 5px rgba(0,0,0,0.14)`,
          }}
        >
          <style>{`@keyframes rh-shimmer{0%{transform:translateX(-160%)}100%{transform:translateX(260%)}}@media (prefers-reduced-motion:reduce){.rh-shimmer{display:none}}`}</style>
          {/* 箔のシャイン（金が一筋すべる） */}
          <span className="rh-shimmer pointer-events-none absolute inset-y-0 left-0 w-1/3" style={{ background: "linear-gradient(105deg, transparent, rgba(255,246,223,.20), transparent)", animation: "rh-shimmer 5s ease-in-out 1.6s infinite" }} />
          {/* 角の金飾り（御札の額装感） */}
          {[["left-1.5 top-1.5 border-l border-t", "rounded-tl"], ["right-1.5 top-1.5 border-r border-t", "rounded-tr"], ["bottom-1.5 left-1.5 border-l border-b", "rounded-bl"], ["bottom-1.5 right-1.5 border-r border-b", "rounded-br"]].map(([pos, rad], i) => (
            <span key={i} className={`pointer-events-none absolute h-2.5 w-2.5 ${pos} ${rad}`} style={{ borderColor: `${theme.accent}cc` }} />
          ))}
          <div className="relative flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-3xl"
              style={{ background: `${theme.accent}26`, boxShadow: `inset 0 0 0 1px ${theme.accent}55` }}
              aria-label="アイコンを変更"
            >
              {ready && avatarUrl ? (
                <Image src={avatarUrl} alt="" fill sizes="56px" className="object-cover" />
              ) : (
                <span>{ready ? rank.icon : "🍶"}</span>
              )}
              <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/55 px-1 py-px text-[8px] font-bold leading-tight text-white">
                <T ja="変更" en="Edit" />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] tracking-[0.2em] text-white/60">{hof ? <T ja="最高位" en="Top Rank" /> : <T ja="あなたの位" en="Your Rank" />}</div>
              <div className="truncate text-2xl font-extrabold leading-tight" style={{ color: theme.accent }}>
                {ready ? <T ja={rank.name} en={rank.nameEn} /> : "—"}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-white/70">{ready ? <T ja={rank.sub} en={rank.subEn} /> : ""}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-3xl font-extrabold leading-none">{ready ? count : "—"}</div>
              <div className="text-[10px] text-white/60"><T ja="種" en="kinds" /></div>
            </div>
          </div>

          {/* 次のランクまで（あと何種） */}
          {ready && next ? (
            <div className="mt-3">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(4, Math.min(100, pct))}%`, background: theme.accent }} />
              </div>
              <p className="mt-1.5 text-[12px] text-white/85">
                <T ja="次は" en="Next:" /> <b style={{ color: theme.accent }}>{next.rank.icon} <T ja={next.rank.name} en={next.rank.nameEn} /></b> ・ <T ja="あと" en="just" /> <b className="text-[15px] text-white">{next.remaining}</b> <T ja="種！" en="more!" />
              </p>
            </div>
          ) : ready && hof ? (
            <p className="mt-3 rounded-xl bg-black/25 px-3 py-2 text-center text-[12.5px] font-bold" style={{ color: theme.accent }}>
              🏆 <T ja="殿堂入り達成！集めるほど図鑑が深まります" en="Hall of Fame reached! The more you collect, the richer your library." />
            </p>
          ) : null}
        </div>

        {/* 隠し酒プレゼント・トラック（30種ごと・そこまで目指したくなる） */}
        {ready && (
          <div className="mt-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-bold text-moss-deep">🎁 <T ja="隠し酒プレゼント" en="Secret Sake Reward" /></p>
              <p className="text-[11px] text-ink-soft"><T ja="獲得" en="Earned" /> {earnedRewards}/{REWARD_MILESTONES.length}</p>
            </div>
            <div className="relative mt-3 h-2 rounded-full bg-[#e7e6e1]">
              <div className="absolute inset-y-0 left-0 rounded-full bg-moss transition-[width] duration-700" style={{ width: `${Math.min(100, (count / HALL_OF_FAME) * 100)}%` }} />
              {REWARD_MILESTONES.map((m) => {
                const earned = count >= m;
                return (
                  <div key={m} className="absolute -top-2.5 -translate-x-1/2" style={{ left: `${(m / HALL_OF_FAME) * 100}%` }}>
                    <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] shadow ${earned ? "bg-[#caa86a] text-white" : "bg-white text-[#b6b4ae] ring-1 ring-hairline"}`}>
                      {earned ? "🎁" : "🔒"}
                    </div>
                    <div className="mt-0.5 text-center text-[9px] text-ink-soft">{m}<T ja="種" en="" /></div>
                  </div>
                );
              })}
            </div>
            <p className="mt-8 text-[12px] text-ink-soft">
              {reward ? (
                <>
                  <T ja="次の隠し酒まで あと" en="Next secret sake in just" /> <b className="text-[14px] text-moss-deep">{reward.remaining}</b> <T ja={`種（${reward.target}種で1杯プレゼント🍶）`} en={`more kinds (a free pour 🍶 at ${reward.target} kinds)`} />
                </>
              ) : (
                <b className="text-moss-deep"><T ja="隠し酒コンプリート！全部GETしました🎉" en="Secret sake complete! You've unlocked them all 🎉" /></b>
              )}
            </p>

            {/* 隠し酒の引換＝マイルストーン特典。お客様が隠し酒を1つ選んで酒神を図鑑に迎える（神おろし）＋店頭で1杯（90ml） */}
            {rewards.length > 0 && (
              <div className="mt-3 border-t border-hairline pt-3">
                {rewards.filter((r) => r.status === "issued").length > 0 ? (
                  <>
                    <p className="text-[11px] font-bold text-moss-deep">🍶 <T ja="引換できる隠し酒があります" en="You have a secret sake to receive" /></p>
                    <div className="mt-2 space-y-2">
                      {rewards.filter((r) => r.status === "issued").map((r) => {
                        const m = /milestone:(\d+)/.exec(r.reason);
                        const milestoneLabel = m ? <T ja={`${m[1]}種達成のごほうび`} en={`Reward for ${m[1]} kinds`} /> : <T ja="達成のごほうび" en="Milestone reward" />;
                        // 既に酒神を迎えた grant＝銘柄＋酒神名＋店頭コードを表示
                        if ((r.sake_id || 0) > 0) {
                          return (
                            <div key={r.id} className="rounded-xl bg-[#fbf3df] px-3 py-2.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-[#8a6a25]">{milestoneLabel}</span>
                                <span className="font-mono text-[14px] font-bold tracking-wider text-[#8a6a25]">{r.code}</span>
                              </div>
                              <p className="mt-1 text-[12px] font-bold text-moss-deep">🐉 「{r.sake_brand}」<T ja="を迎えました" en=" welcomed" />{r.god_name ? <span className="text-[11px] font-normal text-ink-soft">（{r.god_name}）</span> : null}</p>
                              <p className="mt-0.5 text-[10px] text-ink-soft"><T ja="このコードをスタッフに見せると1杯（90ml）お受け取りいただけます。" en="Show this code to our staff to receive your pour (90ml)." /></p>
                            </div>
                          );
                        }
                        // まだ選んでいない grant＝隠し酒ピッカー
                        const open = claimFor === r.id;
                        return (
                          <div key={r.id} className="rounded-xl bg-[#fbf3df] px-3 py-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-[#8a6a25]">{milestoneLabel}</span>
                              {!open && (
                                <button onClick={() => { setClaimError(""); setClaimFor(r.id); }} className="rounded-full bg-moss px-3 py-1 text-[11px] font-bold text-white">
                                  <T ja="隠し酒を選ぶ" en="Choose" />
                                </button>
                              )}
                            </div>
                            {!open ? (
                              <p className="mt-1 text-[11px] text-[#8a6a25]"><T ja="達成おめでとうございます。隠し酒を1つ選んで、その酒神を図鑑に迎えましょう。" en="Congrats! Choose one secret sake to welcome its god into your library." /></p>
                            ) : claimable.length === 0 ? (
                              <p className="mt-1 text-[11px] text-ink-soft"><T ja="いま提供できる隠し酒がありません。店頭でスタッフにお声がけください。" en="No secret sake is available right now — please ask our staff." /></p>
                            ) : (
                              <>
                                <p className="mt-1.5 text-[11px] font-bold text-moss-deep"><T ja="どの隠し酒を迎えますか？" en="Which secret sake will you welcome?" /></p>
                                <div className="mt-1.5 space-y-1.5">
                                  {claimable.map((h) => {
                                    const meta = RARITY_META[h.rarity as Rarity] || RARITY_META.LR;
                                    const art = h.hasArt ? `/api/god-art/${h.sakeId}?v=${(h.godUpdated || "").replace(/\D/g, "").slice(0, 14) || "0"}` : null;
                                    return (
                                      <button key={h.sakeId} disabled={claiming} onClick={() => pickHiddenGod(r.id, h)} className="flex w-full items-center gap-2.5 rounded-xl bg-white px-2.5 py-2 text-left ring-1 ring-hairline transition active:scale-[.99] disabled:opacity-50">
                                        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ background: `${meta.color}22`, boxShadow: `inset 0 0 0 1.5px ${meta.color}` }}>
                                          {art ? <Image src={art} alt="" width={44} height={44} className="h-full w-full object-cover" /> : <span className="text-[18px]">🐉</span>}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-[12.5px] font-bold text-ink">{h.brand}</span>
                                          <span className="block truncate text-[10.5px] text-ink-soft">{h.godName}</span>
                                        </span>
                                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: meta.color }}>{h.rarity}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="mt-1.5 flex items-center justify-between">
                                  <button onClick={() => { setClaimFor(null); setClaimError(""); }} className="text-[11px] text-ink-soft underline"><T ja="やめる" en="Cancel" /></button>
                                  {claiming && <span className="text-[11px] text-moss-deep"><T ja="迎えています…" en="Welcoming…" /></span>}
                                </div>
                              </>
                            )}
                            {claimError && open && (
                              <p className="mt-1 text-[11px] text-[#9b2d20]">
                                {claimError === "owned" ? <T ja="その酒神はすでに図鑑にあります。別の隠し酒を選んでください。" en="That god is already in your library — pick another." />
                                  : claimError === "gone" ? <T ja="その隠し酒は今ご用意がありません。別の隠し酒を選んでください。" en="That secret sake isn't available now — pick another." />
                                  : <T ja="迎えられませんでした。もう一度お試しください。" en="Could not welcome it. Please try again." />}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[10px] text-ink-soft"><T ja="※ 20歳以上の方・隠し酒1杯（90ml）・お会計の2割以内でご提供。抽選はありません（達成された方は条件なしで必ずお受け取りいただけます）。" en="* Ages 20+. One pour (90ml) of a secret sake, within 20% of your bill. No lottery — if you've reached the milestone, it's yours, no conditions." /></p>
                  </>
                ) : (
                  <p className="text-[11px] text-ink-soft"><T ja="これまでの隠し酒はすべて引換済みです 🎉" en="You've redeemed every secret sake so far 🎉" /></p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ランクの道（集めた種類数で昇格・先が見えて上を目指したくなる。最後は殿堂入り） */}
        {ready && (
          <div className="scrollbar-none mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {RANKS.map((r, i) => {
              const reached = rankIdx >= i;
              const isCurrent = rankIdx === i;
              const goal = r.min === HALL_OF_FAME;
              return (
                <span
                  key={r.min}
                  className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    isCurrent
                      ? "bg-moss-deep text-white"
                      : goal && !reached
                      ? "bg-gilt-bg text-gilt ring-1 ring-gilt-line"
                      : reached
                      ? "bg-[#eef3ef] text-moss-deep"
                      : "bg-[#f0efec] text-[#b6b4ae]"
                  }`}
                  title={`${r.min}種〜`}
                >
                  <span>{r.icon}</span>
                  {r.name}
                  {!reached && <span className="opacity-70">{r.min}</span>}
                </span>
              );
            })}
          </div>
        )}
        {/* 北極星：位は「量」でなく「出会った神の数」で上がる（飲み過ぎを煽らない・節度ある飲酒） */}
        {ready && (
          <p className="mt-2 px-1 text-[10.5px] leading-relaxed text-ink-soft">
            <T ja="位は、飲んだ量ではなく、出会った神の数（集めた種類）で上がります。" en="Your rank rises by the gods you meet — never by how much you drink." />
          </p>
        )}

        {/* 図鑑（種類）コレクション ＆ ランキング切替（殿堂入り後も増え続ける） */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setTab("all")}
            className={`rounded-xl py-2 text-center shadow-[0_1px_3px_rgba(38,40,43,0.05)] active:scale-[0.99] ${tab === "all" ? "bg-moss-deep" : "bg-card"}`}
          >
            <div className={`text-xl font-extrabold leading-none ${tab === "all" ? "text-white" : "text-moss-deep"}`}>
              {ready ? `${count}` : "—"}
              <span className="text-[11px] font-bold"> <T ja="種" en="kinds" /></span>
            </div>
            <div className={`mt-1 text-[10px] ${tab === "all" ? "text-white/75" : "text-ink-soft"}`}><T ja="図鑑コレクション" en="Collection" /></div>
          </button>
          <button
            onClick={() => setTab("ranking")}
            className={`flex flex-col items-center justify-center rounded-xl py-2 shadow-[0_1px_3px_rgba(38,40,43,0.05)] active:scale-[0.99] ${tab === "ranking" ? "bg-moss-deep text-white" : "bg-card text-moss-deep"}`}
          >
            <div className="text-base font-extrabold leading-none">🏆 <T ja="図鑑ランキング" en="Rankings" /></div>
            <div className={`mt-1 text-[10px] ${tab === "ranking" ? "text-white/75" : "text-ink-soft"}`}><T ja="みんなの順位を見る" en="See everyone's standings" /></div>
          </button>
        </div>

        {ready && count > 0 && (
          <button
            onClick={makeShareImage}
            disabled={sharing}
            className="mt-4 w-full rounded-full bg-moss-deep py-3.5 text-sm font-bold tracking-wider text-white shadow-[0_8px_22px_rgba(30,61,47,0.3)] disabled:opacity-50"
          >
            {sharing ? <T ja="画像を作成中…" en="Creating image…" /> : <T ja="📸 図鑑をシェアする" en="📸 Share my library" />}
          </button>
        )}

        {/* LINEログインで図鑑を保存（端末をまたいで・ずっと残る） */}
        {ready && !loggedIn && (
          <div className="mt-3 rounded-2xl border border-[#06C755]/25 bg-[#eef7f0] p-3.5">
            {count >= 3 && (
              <MascotSpeech size={46} className="mb-3">
                <T
                  ja={`ここまで${count}種、集まりましたね。このまま消したくないですよね。LINEとつなげば、機種変更しても・別の端末でも図鑑が残りますよ。`}
                  en={`You've gathered ${count} kinds so far — you wouldn't want to lose them, right? Connect LINE and your library stays, even on a new phone or another device.`}
                />
              </MascotSpeech>
            )}
            <p className="text-[12.5px] font-bold text-moss-deep">📱 <T ja="図鑑をずっと残すなら" en="Keep your library forever" /></p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
              <T ja={<>いまは<b className="text-moss-deep">この端末だけ</b>の保存です。LINEで保存すると、機種変更や別の端末でも、来店をまたいでも図鑑が消えません。</>} en={<>Right now it's saved on <b className="text-moss-deep">this device only</b>. Save with LINE and your library stays with you across new phones, other devices, and every visit.</>} />
            </p>
            <a
              href="/api/auth/line/login"
              className="mt-2.5 flex items-center justify-center gap-2 rounded-full bg-[#06C755] py-3 text-sm font-bold text-white active:scale-[0.99]"
            >
              <span className="text-base">＋</span> <T ja="LINEで図鑑を保存する" en="Save my library with LINE" />
            </a>
          </div>
        )}
        {ready && loggedIn && member && (
          <div className="mt-3 flex items-center gap-2 rounded-full bg-[#eef3ef] px-3 py-2 text-[11px] text-moss-deep">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {member.picture ? <img src={member.picture} alt="" className="h-5 w-5 rounded-full" /> : <span>🟢</span>}
            <span className="font-bold">{member.name || <T ja="あなた" en="You" />}</span>
            <span className="text-ink-soft"><T ja="の図鑑（保存中・どの端末でも残ります）" en="'s library (saved · stays on every device)" /></span>
          </div>
        )}

        {/* 酒神のランク（レア度）＋集めた数（図鑑トップに常時表示） */}
        <div className="mt-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
          <p className="text-[13px] font-bold text-moss-deep">🐉 <T ja="酒神のランク（レア度）" en="Sake-god Ranks (Rarity)" /></p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-soft">
            <T ja="飲んだ酒に宿る酒神は、価格や造りで6つの位に分かれます。" en="Each sake-god is graded into six ranks by price and brewing." />
          </p>
          <div className="mt-3 space-y-1.5">
            {RARITIES.map((r) => {
              const m = RARITY_META[r];
              const n = rarityCounts[r] || 0;
              return (
                <div key={r} className="flex items-center gap-2.5">
                  <span className="inline-flex shrink-0 items-center justify-center rounded-md py-0.5 text-[11px] font-bold" style={{ background: m.bg, color: m.color, width: 70 }}>
                    {r}・{m.jp}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-soft"><T ja={RANK_DESC[r].ja} en={RANK_DESC[r].en} /></span>
                  <span className={`shrink-0 text-[12.5px] font-bold ${n > 0 ? "text-moss-deep" : "text-[#b8bcc2]"}`}>{n}<T ja="体" en="" /></span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* フィルタ */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto px-6 py-4">
        {([
          ["all", <T ja="すべて" en="All" />],
          ["conquest", <T ja="🗾 制覇" en="🗾 Conquest" />],
          ["ranking", <T ja="🏆 ランキング" en="🏆 Rankings" />],
          ["history", <T ja="履歴" en="History" />],
          ["locked", <T ja="未開拓" en="Locked" />],
        ] as [Tab, ReactNode][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
              tab === key ? "border-moss bg-moss text-white" : "border-hairline bg-card text-ink-soft"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 図鑑ランキング（集めた種類数の順位・全員参加） */}
      {tab === "ranking" && (
        <div className="px-5">
          {/* ランキングを見たお客様がそのまま注文に進めるCTA */}
          <Link
            href="/"
            className="mb-3 flex items-center justify-center gap-2 rounded-full bg-moss-deep py-3.5 text-sm font-bold tracking-wider text-white shadow-[0_8px_22px_rgba(30,61,47,0.3)]"
          >
            🍶 <T ja="日本酒を注文する →" en="Order sake →" />
          </Link>
          {/* 表示名の変更（任意・LINE不要） */}
          <div className="mb-2 flex items-center justify-center gap-2 text-[12px]">
            <span className="text-ink-soft"><T ja="あなたの表示名" en="Your display name" /></span>
            <b className="max-w-[8rem] truncate text-moss-deep">
              {(loggedIn ? member?.name : myRank?.name || guestName()) || <T ja="ゲスト" en="Guest" />}
            </b>
            <button onClick={editName} className="rounded-full border border-hairline px-2.5 py-1 text-[11px] font-bold text-moss-deep active:scale-95">
              ✎ <T ja="変更" en="Edit" />
            </button>
          </div>
          <p className="mb-3 text-center text-[11px] text-ink-soft">
            <T ja={<>集めた「種類数」のランキング。<b className="text-moss-deep">LINE登録なしでも参加</b>・名前は任意です。</>} en={<>Ranked by how many kinds you've collected. <b className="text-moss-deep">No LINE sign-up needed</b> · name is optional.</>} />
          </p>
          {ranking === null ? (
            <p className="py-10 text-center text-sm text-ink-soft"><T ja="番付を、整えています…" en="Preparing the rankings…" /></p>
          ) : ranking.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-soft">
              <T ja={<>まだ誰もいません。日本酒を注文して図鑑に集めると、<br />あなたが最初のランクインです🍶</>} en={<>No one here yet. Order sake and collect it in your library, and you'll be the first on the board 🍶</>} />
            </p>
          ) : (
            <div className="space-y-2">
              <div className="mb-2 flex items-center justify-center gap-2.5 text-[#8a6a25]">
                <span className="h-px w-9" style={{ background: "linear-gradient(90deg,transparent,#caa86a)" }} />
                <span className="text-[14px] font-bold tracking-[0.34em]" style={{ fontFamily: "'Yu Mincho','Hiragino Mincho ProN',serif" }}>今宵の番付</span>
                <span className="h-px w-9" style={{ background: "linear-gradient(90deg,#caa86a,transparent)" }} />
              </div>
              {ranking.map((r) => (
                <div
                  key={r.rank}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow-[0_1px_3px_rgba(38,40,43,0.05)] ${
                    r.isMe ? "bg-moss text-white ring-2 ring-moss-deep" : r.rank <= 3 ? "bg-gilt-bg" : "bg-card"
                  }`}
                >
                  <div className="flex w-8 shrink-0 flex-col items-center leading-none">
                    <span className={`text-lg font-extrabold ${r.isMe ? "text-white" : r.rank <= 3 ? "text-gilt" : "text-ink-soft"}`}>{r.rank}</span>
                    {r.rank <= 3 && (
                      <span className={`mt-0.5 text-[8px] font-bold ${r.isMe ? "text-white/90" : "text-gilt"}`} style={{ fontFamily: "'Yu Mincho','Hiragino Mincho ProN',serif" }}>
                        {r.rank === 1 ? "横綱" : r.rank === 2 ? "大関" : "関脇"}
                      </span>
                    )}
                  </div>
                  {r.avatar ? (
                    // 酒神アイコン優先
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/god-art/${r.avatar}`} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : r.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.picture} alt="" className="h-8 w-8 rounded-full" />
                  ) : (
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${r.isMe ? "bg-white/20" : "bg-[#eef3ef]"}`}>🍶</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {r.name}
                    {r.isMe && <span className="ml-1.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold"><T ja="あなた" en="You" /></span>}
                  </span>
                  <span className={`shrink-0 text-sm font-bold ${r.isMe ? "text-white" : "text-moss-deep"}`}>{r.kinds}<T ja="種" en="" /></span>
                </div>
              ))}
              {/* 本人が上位10名の外なら、区切って自分の順位を表示 */}
              {myRank && myRank.rank > 10 && (
                <>
                  <p className="py-0.5 text-center text-[18px] leading-none text-ink-soft">⋯</p>
                  <div className="flex items-center gap-3 rounded-2xl bg-moss px-4 py-3 text-white shadow-[0_1px_3px_rgba(38,40,43,0.05)] ring-2 ring-moss-deep">
                    <span className="w-7 text-center text-lg font-extrabold text-white">{myRank.rank}</span>
                    {myRank.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/god-art/${myRank.avatar}`} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : myRank.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={myRank.picture} alt="" className="h-8 w-8 rounded-full" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm">🍶</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">
                      {myRank.name}
                      <span className="ml-1.5 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-bold"><T ja="あなた" en="You" /></span>
                    </span>
                    <span className="shrink-0 text-sm font-bold text-white">{myRank.kinds}<T ja="種" en="" /></span>
                  </div>
                </>
              )}
              {rankTotal > 10 && (
                <p className="pt-1 text-center text-[10px] text-ink-soft"><T ja={`参加 ${rankTotal} 人中・上位10名を表示`} en={`${rankTotal} participants · showing top 10`} /></p>
              )}
            </div>
          )}
          {/* スクロール後でも注文に戻れるCTA */}
          <Link
            href="/"
            className="mt-4 flex items-center justify-center gap-2 rounded-full border border-moss bg-card py-3 text-sm font-bold text-moss-deep"
          >
            🍶 <T ja="日本酒を注文する →" en="Order sake →" />
          </Link>
        </div>
      )}

      {/* 履歴（飲んだ順） */}
      {tab === "history" && (
        <div className="space-y-2 px-5">
          {history.map((e) => (
            <Link
              key={e.id}
              href={`/sake/${e.id}`}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-[0_1px_3px_rgba(38,40,43,0.05)]"
            >
              <div className="h-8 w-3 shrink-0 rounded-[3px]" style={{ background: e.labelColor }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold"><T ja={e.brand} en={e.en?.brand || e.brand} /></p>
                <p className="truncate text-[11px] text-ink-soft">{e.outOfCatalog ? <T ja="提供終了・図鑑に記録" en="No longer served · saved in your library" /> : <T ja={e.prefecture} en={e.en?.prefecture || e.prefecture} />}</p>
              </div>
              <span className="shrink-0 text-right text-xs text-moss">
                {e.cnt > 1 && <b className="mr-1">{e.cnt}<T ja="杯" en=" pours" /></b>}
                {e.date ? formatDate(e.date) : <T ja="記録済み" en="Recorded" />}
              </span>
              {e.status !== "soldout" && !e.outOfCatalog && (
                <QuickAdd
                  sake={{ id: e.id, brand: e.brand, grade: e.grade, price: e.price, volume: e.volume }}
                  className="shrink-0"
                />
              )}
            </Link>
          ))}
          {history.length === 0 && (
            <p className="py-16 text-center text-sm text-ink-soft"><T ja="まだ記録がありません" en="No records yet" /></p>
          )}
        </div>
      )}

      {/* 制覇（蔵元・8地方コンプ） */}
      {tab === "conquest" && (
        <div className="px-5">
          {!conquest.hasData ? (
            <p className="rounded-2xl bg-card px-4 py-8 text-center text-[12.5px] text-ink-soft">
              <T ja={<>制覇は、銘柄に産地・蔵元の情報がそろうと表示されます。<br />日本酒を集めていくと、地方や蔵がうまっていきます。</>} en={<>Conquest appears once your sake have region and brewery details.<br />As you collect, regions and breweries fill in.</>} />
            </p>
          ) : (
            <>
              {/* 8地方制覇 */}
              <div className="rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
                <div className="flex items-baseline justify-between">
                  <p className="text-[13px] font-bold text-moss-deep">🗾 <T ja="全国制覇" en="National Conquest" /></p>
                  <p className="text-[11px] text-ink-soft"><T ja="点灯" en="Lit" /> <b className="text-moss-deep">{conquest.litRegions}</b> / {conquest.regions.length} <T ja="地方" en="regions" /></p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {conquest.regions.map((r) => {
                    const complete = r.got >= r.total && r.total > 0;
                    const lit = r.got >= Math.min(3, r.total) && r.got > 0;
                    const pctR = r.total ? Math.round((r.got / r.total) * 100) : 0;
                    return (
                      <div key={r.name} className="rounded-xl px-3 py-2" style={{ background: complete ? "#f6ead0" : lit ? "#eaf2ec" : "#f1f0ec" }}>
                        <div className="flex items-baseline justify-between">
                          <span className={`text-[12px] font-bold ${complete ? "text-[#9a7b1f]" : lit ? "text-moss-deep" : "text-ink-soft"}`}>{r.name}</span>
                          <span className="text-[10px] text-ink-soft">{r.got}/{r.total}{complete ? " 🏆" : lit ? " ✓" : ""}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-black/5">
                          <div className="h-full rounded-full" style={{ width: `${pctR}%`, background: complete ? "#caa44c" : "#3f7a5a" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 蔵元制覇 */}
              {conquest.breweries.length > 0 && (
                <div className="mt-3 rounded-2xl bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.05)]">
                  <p className="text-[13px] font-bold text-moss-deep">🏯 <T ja="蔵元制覇" en="Brewery Conquest" /></p>
                  <p className="mt-0.5 text-[11px] text-ink-soft"><T ja="その蔵で出会った全銘柄を集めると制覇。あと1本がねらい目。" en="Conquer a brewery by collecting every label you've met from it. Watch for the ones just one bottle away." /></p>
                  <div className="mt-3 space-y-2">
                    {conquest.breweries.map((b) => {
                      const complete = b.got >= b.total;
                      const reach = !complete && b.total - b.got === 1 && b.got > 0;
                      const pctB = b.total ? Math.round((b.got / b.total) * 100) : 0;
                      return (
                        <div key={b.name} className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between">
                              <span className="truncate text-[12.5px] font-bold">{b.name}</span>
                              <span className="ml-2 shrink-0 text-[11px] text-ink-soft">
                                {b.got}/{b.total}
                                {complete ? <T ja=" 🏆制覇" en=" 🏆 Conquered" /> : reach ? <b className="text-[#b06a2a]"> <T ja="あと1本！" en="1 more!" /></b> : ""}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-[#ecebe7]">
                              <div className="h-full rounded-full" style={{ width: `${pctB}%`, background: complete ? "#caa44c" : reach ? "#d08a3a" : "#3f7a5a" }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 図鑑グリッド */}
      {tab !== "history" && tab !== "ranking" && tab !== "conquest" && (
      <div className="grid grid-cols-3 gap-3 px-5">
        {visible.map((e, index) => {
          const isTasted = ready && tasted.has(e.id);
          const rm = isTasted && e.rarity ? RARITY_META[e.rarity as Rarity] || null : null;
          // 図鑑グリッドは「酒神キャラ」優先。絵が無い銘柄はラベル写真にフォールバック。
          const godUrl = isTasted && e.hasArt ? `/api/god-art/${e.id}?v=${(e.godUpdated || "").replace(/\D/g, "").slice(0, 14) || "0"}` : null;
          const no = String(index + 1).padStart(3, "0"); // 図録の通し番号（表示用）
          const cell = (
            <div
              className={`overflow-hidden rounded-xl transition-all ${
                isTasted ? "bg-card shadow-[0_1px_3px_rgba(38,40,43,0.07)]" : ""
              } ${e.isPremium && isTasted && !rm ? "ring-1 ring-inset ring-gilt-line" : ""}`}
              style={
                isTasted
                  ? rm ? { boxShadow: `inset 0 0 0 1.5px ${rm.ring}, 0 1px 3px rgba(38,40,43,0.07)` } : undefined
                  : { background: "#13201a", boxShadow: "inset 0 0 0 1px rgba(202,168,106,0.14)" } // 未取得＝墨に沈んだ影
              }
            >
              <div
                className="relative flex h-24 items-center justify-center"
                style={{
                  background: godUrl ? "#0c241b" : isTasted ? `color-mix(in srgb, ${e.labelColor} 10%, #f4f2ee)` : "radial-gradient(circle at 50% 38%, #1c2c24 0%, #0e1813 78%)",
                }}
              >
                {godUrl ? (
                  // 酒神キャラ（集めた＝降臨した神が並ぶ）
                  <Image src={godUrl} alt={e.brand} fill sizes="(max-width: 512px) 31vw, 160px" className="object-cover" />
                ) : isTasted && e.hasPhoto ? (
                  // 絵が無い銘柄はラベル写真にフォールバック
                  <>
                    <BottleSilhouette color={e.labelColor} faded={false} />
                    <div className="absolute inset-0">
                      <BottleArt
                        color={e.labelColor}
                        photoUrl={photoUrl(e.id, e.updatedAt)}
                        alt={e.brand}
                        sizes="(max-width: 512px) 31vw, 160px"
                        priority={index < 6}
                      />
                    </div>
                  </>
                ) : isTasted ? (
                  <BottleSilhouette color={e.labelColor} faded={false} />
                ) : (
                  // 未取得＝墨色のシルエット＋「？」（まだ見ぬ神）
                  <>
                    <BottleSilhouette color="#2c4034" faded={false} />
                    <span className="absolute text-[28px] font-bold" style={{ color: "rgba(202,168,106,0.22)", fontFamily: "'Yu Mincho','Hiragino Mincho ProN',serif" }}>？</span>
                  </>
                )}
                {/* 図録No.札 */}
                <span className="absolute bottom-1 left-1 rounded px-1 py-0.5 text-[7px] font-bold leading-none tracking-wider" style={isTasted ? { background: "rgba(13,31,23,.6)", color: "#e8d1a0" } : { background: "rgba(202,168,106,.1)", color: "rgba(232,209,160,.5)" }}>No.{no}</span>
                {e.isPremium && isTasted && (
                  <span className="absolute right-1 top-1 text-[10px] text-gilt">◆</span>
                )}
                {rm && (
                  <span className="absolute left-1 top-1 rounded px-1 py-0.5 text-[8px] font-extrabold leading-none text-white shadow-sm" style={{ background: rm.color }}>
                    {e.rarity}
                  </span>
                )}
                {isTasted && e.status !== "soldout" && !e.outOfCatalog && (
                  <QuickAdd
                    sake={{ id: e.id, brand: e.brand, grade: e.grade, price: e.price, volume: e.volume }}
                    className="absolute bottom-1.5 right-1.5"
                  />
                )}
              </div>
              <div className="px-2 py-1.5 text-center" style={isTasted ? undefined : { background: "#13201a" }}>
                <p className={`truncate text-[11px] font-bold ${isTasted ? "" : "text-[#e8d1a0]/75"}`}>
                  {isTasted ? <T ja={e.brand} en={e.en?.brand || e.brand} /> : "？？？"}
                </p>
                <p className="truncate text-[9px]" style={isTasted ? undefined : { color: "rgba(232,209,160,0.4)" }}>
                  {isTasted ? (
                    e.outOfCatalog ? <T ja="提供終了・図鑑に記録" en="No longer served · in your library" /> : <T ja={e.prefecture} en={e.en?.prefecture || e.prefecture} />
                  ) : (
                    <T ja="まだ見ぬ神" en="A god yet unseen" />
                  )}
                </p>
                {!isTasted && <span className="sr-only">Locked</span>}
              </div>
            </div>
          );
          return isTasted ? (
            <Link key={e.id} href={`/sake/${e.id}`} className="block">
              {cell}
            </Link>
          ) : (
            <div key={e.id}>{cell}</div>
          );
        })}
      </div>
      )}

      {tab !== "history" && tab !== "ranking" && visible.length === 0 && (
        <p className="px-6 py-16 text-center text-sm text-ink-soft"><T ja="該当なし" en="Nothing here" /></p>
      )}

      <p className="px-6 pt-8 text-center text-[11px] text-ink-soft">
        <T ja="記録はこの端末に保存されます（ログイン不要）。" en="Your records are saved on this device (no login needed)." />
        <br />
        <T ja="日本酒を注文すると、自動で図鑑に登録されます（同じお酒は1回だけ）。" en="Order sake and it's added to your library automatically (each sake counts once)." />
        <br />
        <span className="text-[10px] text-[#b6b4ae]"><T ja="※ 酒神キャラクターはAI生成のオリジナルで、酒蔵とは一切関係がありません。" en="* The sake-god characters are original AI-generated art, unaffiliated with any brewery." /></span>
        <br />
        <span className="text-[10px] text-[#b6b4ae]"><T ja="20歳未満の飲酒は法律で禁止されています。お酒は適量を、楽しく。" en="Underage drinking is prohibited by law. Please drink responsibly." /></span>
      </p>

      {/* シェア投稿プレビュー（Instagram/LINE/Xに飛ぶ前に必ず確認できる） */}
      {share && (
        <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/75 px-5 py-8" onClick={closeShare}>
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <p className="text-center text-sm font-bold text-white"><T ja="投稿プレビュー" en="Post Preview" /></p>
            <p className="mt-1 text-center text-[11px] text-white/70"><T ja="この画像と文章で投稿できます。投稿先を選んでください。" en="Post with this image and caption. Choose where to share." /></p>

            {/* フォーマット切替（ストーリーズ9:16 / フィード4:5） */}
            <div className="mx-auto mt-3 flex w-full max-w-[260px] gap-1 rounded-full bg-white/10 p-1">
              {([
                ["story", <T ja="ストーリーズ" en="Stories" />, "9:16"],
                ["feed", <T ja="フィード" en="Feed" />, "4:5"],
              ] as const).map(([key, label, ratio]) => (
                <button
                  key={key}
                  onClick={() => switchFormat(key)}
                  disabled={regenerating}
                  className={`flex-1 rounded-full py-2 text-[12px] font-bold transition-colors ${
                    format === key ? "bg-white text-ink" : "text-white/80"
                  }`}
                >
                  {label}
                  <span className={`ml-1 text-[10px] font-normal ${format === key ? "text-ink-soft" : "text-white/50"}`}>{ratio}</span>
                </button>
              ))}
            </div>

            <div className="relative mx-auto mt-3 w-full max-w-[260px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={share.url} alt="図鑑シェア画像" className={`w-full rounded-2xl shadow-2xl transition-opacity ${regenerating ? "opacity-40" : ""}`} />
              {regenerating && (
                <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold text-white"><T ja="作成中…" en="Creating…" /></span>
              )}
            </div>

            {/* SNS導線 */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <button onClick={openInstagram} className="flex flex-col items-center gap-0.5 rounded-2xl bg-[#E1306C] py-3 text-[11px] font-bold text-white">
                <span className="text-lg">📷</span> Instagram
                <span className="text-[9px] font-normal text-white/80">{format === "story" ? <T ja="ストーリーズ" en="Stories" /> : <T ja="フィード" en="Feed" />}</span>
              </button>
              <button onClick={openLine} className="flex flex-col items-center gap-1 rounded-2xl bg-[#06C755] py-3 text-[11px] font-bold text-white">
                <span className="text-lg">💬</span> LINE
              </button>
              <button onClick={openX} className="flex flex-col items-center gap-1 rounded-2xl bg-black py-3 text-[11px] font-bold text-white">
                <span className="text-lg">✕</span> X
              </button>
            </div>

            <button onClick={nativeShare} className="mt-3 w-full rounded-full bg-moss py-3 text-sm font-bold text-white">
              📲 <T ja="写真つきでそのまま投稿" en="Share with photo" />
            </button>
            <div className="mt-2 flex gap-3">
              <button onClick={saveImage} className="flex-1 rounded-full bg-white py-3 text-sm font-bold text-ink">
                <T ja="画像を保存" en="Save image" />
              </button>
              <button onClick={closeShare} className="flex-1 rounded-full border border-white/40 py-3 text-sm text-white">
                <T ja="閉じる" en="Close" />
              </button>
            </div>
            <p className="mt-3 text-center text-[10.5px] leading-relaxed text-white/60">
              <T ja={<>Instagram・X・写真つき投稿は<b className="text-white/80">画像だけ</b>を出します（説明文は付きません）。<br />LINEは説明文＋リンクで開きます（画像を送るなら「画像を保存」を）。</>} en={<>Instagram, X, and Share with photo post the <b className="text-white/80">image only</b> (no caption).<br />LINE opens with a caption and link (use "Save image" if you want to send the picture).</>} />
            </p>
          </div>
        </div>
      )}
      {/* アイコン（酒神）を選ぶ */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={() => setPickerOpen(false)}>
          <div className="max-h-[82vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-paper p-5 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-bold text-ink"><T ja="アイコンを選ぶ" en="Choose your icon" /></p>
              <button onClick={() => setPickerOpen(false)} className="text-[13px] text-ink-soft"><T ja="閉じる" en="Close" /></button>
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">
              <T ja="集めた酒神からアイコンを選べます（位カードやランキングに表示）。" en="Pick an icon from the gods you've collected (shown on your rank card and the ranking)." />
            </p>
            {avatarChoices.length === 0 ? (
              <p className="py-10 text-center text-[12.5px] text-ink-soft">
                <T ja="まだ酒神がいません。日本酒を注文して集めると、ここから選べます🍶" en="No gods yet. Order and collect sake, then choose one here 🍶" />
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-4 gap-2.5">
                {/* 既定（位アイコン）に戻す */}
                <button
                  onClick={() => { setAvatar(0); setPickerOpen(false); }}
                  className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl bg-card text-2xl ${avatarSakeId === 0 ? "ring-2 ring-moss-deep" : "ring-1 ring-hairline"}`}
                >
                  <span>{rank.icon}</span>
                  <span className="text-[8px] font-bold text-ink-soft"><T ja="位" en="Rank" /></span>
                </button>
                {avatarChoices.map((e) => {
                  const url = `/api/god-art/${e.id}?v=${(e.godUpdated || "").replace(/\D/g, "").slice(0, 14) || "0"}`;
                  const sel = avatarSakeId === e.id;
                  const rm = e.rarity ? RARITY_META[e.rarity as Rarity] || null : null;
                  return (
                    <button
                      key={e.id}
                      onClick={() => { setAvatar(e.id); setPickerOpen(false); }}
                      className="relative aspect-square overflow-hidden rounded-xl bg-[#0c241b]"
                      style={{ boxShadow: sel ? "0 0 0 2.5px #1f4d39" : `inset 0 0 0 1.5px ${rm?.ring || "#d4d8d2"}` }}
                      title={e.godName || e.brand}
                    >
                      <Image src={url} alt={e.godName || e.brand} fill sizes="90px" className="object-cover" />
                      {sel && <span className="absolute right-0.5 top-0.5 rounded-full bg-moss-deep px-1 text-[9px] font-bold leading-tight text-white">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 隠し酒を迎えたときの神おろし演出（注文時と同じ SakegamiReveal を発火） */}
      {claimReveal && (
        <SakegamiReveal
          name={claimReveal.name}
          rarity={claimReveal.rarity}
          artUrl={claimReveal.artUrl}
          onClose={() => setClaimReveal(null)}
        />
      )}
    </>
  );
}

function BottleSilhouette({ color, faded }: { color: string; faded: boolean }) {
  return (
    <svg viewBox="0 0 20 52" className="h-16" style={{ opacity: faded ? 0.5 : 1 }}>
      <path
        fill={color}
        d="M8 0h4v4c0 3 1 5 2.5 7 1.6 2.2 2.5 4.5 2.5 8v28a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V19c0-3.5.9-5.8 2.5-8C7 9 8 7 8 4Z"
      />
    </svg>
  );
}
