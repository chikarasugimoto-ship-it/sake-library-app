"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { T } from "@/components/T";

// 20歳確認ゲート。お客様の入口で一度だけ「20歳以上ですか？」を確認し、localStorageに記憶。
// 酒類アプリの存在条件（未成年の飲酒誘引を避ける）。スタッフ画面・法令ページでは出さない。
const KEY = "sksl.age.ok";
const SKIP = ["/admin", "/unsupported", "/privacy", "/terms"];

export function AgeGate() {
  const pathname = usePathname();
  const [phase, setPhase] = useState<"loading" | "ask" | "ok" | "denied">("loading");

  useEffect(() => {
    let ok = false;
    try {
      ok = localStorage.getItem(KEY) === "1";
    } catch {
      ok = false;
    }
    setPhase(ok ? "ok" : "ask");
  }, []);

  if (SKIP.some((p) => pathname?.startsWith(p))) return null;
  if (phase === "loading" || phase === "ok") return null;

  function confirm() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // 保存できなくても先へ進める（毎回確認になるだけ）
    }
    setPhase("ok");
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-7"
      style={{ background: "linear-gradient(160deg,#163a2c,#0b211a)" }}
    >
      <div
        className="w-full max-w-xs rounded-3xl p-7 text-center"
        style={{ background: "linear-gradient(155deg,#1f4636,#0e2a20)", boxShadow: "0 20px 50px rgba(0,0,0,.45), inset 0 0 0 1px #caa86a55" }}
      >
        <p className="text-[11px] font-bold tracking-[0.3em] text-[#caa86a]">酒コレ ・ 酒神コレクション</p>
        {phase === "denied" ? (
          <>
            <p className="mt-5 text-[17px] font-bold text-white">
              <T ja="ご利用いただけません" en="Access not available" />
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-white/75">
              <T
                ja="申し訳ありません。日本酒を扱うアプリのため、20歳未満の方はご利用いただけません。"
                en="Sorry — this app serves sake and is available to ages 20 and over only."
              />
            </p>
          </>
        ) : (
          <>
            <p className="mt-5 text-[18px] font-bold text-white">
              <T ja="あなたは20歳以上ですか？" en="Are you 20 or older?" />
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-white/70">
              <T ja="日本酒を扱うアプリです。20歳以上の方のみご利用いただけます。" en="This app serves sake and is for ages 20+ only." />
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                onClick={confirm}
                className="w-full rounded-full bg-[#caa86a] py-3.5 text-[14px] font-bold text-[#16352a] active:scale-95"
              >
                <T ja="はい（20歳以上）" en="Yes, I'm 20 or older" />
              </button>
              <button
                onClick={() => setPhase("denied")}
                className="w-full rounded-full border border-white/25 py-3 text-[13px] font-bold text-white/80 active:scale-95"
              >
                <T ja="いいえ" en="No" />
              </button>
            </div>
          </>
        )}
        <p className="mt-6 text-[10px] leading-relaxed text-[#caa86a]/80">
          <T ja="20歳未満の飲酒は法律で禁止されています。お酒は適量を、楽しく。" en="Underage drinking is prohibited by law. Please drink responsibly." />
        </p>
      </div>
    </div>
  );
}
