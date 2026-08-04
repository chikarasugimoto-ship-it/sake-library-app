"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { T } from "@/components/T";

// 画面下部に固定の大きめナビ（注文 / 図鑑）。スクロールしても常に表示＝見つけやすい。
// 客向けアプリ（/ , /zukan , /sake/*）だけに出す。オープニング/管理/公開プロフィールには出さない。
export function BottomNav() {
  const pathname = usePathname();
  const show = pathname === "/" || pathname === "/zukan" || pathname.startsWith("/sake/");
  if (!show) return null;
  const onZukan = pathname === "/zukan";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-card shadow-[0_-6px_20px_rgba(30,61,47,0.12)] pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-lg">
        <NavTab href="/" label={<T ja="日本酒を注文" en="Order Sake" />} icon="🍶" on={!onZukan} />
        <NavTab href="/zukan" label={<T ja="日本酒図鑑" en="Sake Collection" />} icon="📖" on={onZukan} />
      </div>
    </nav>
  );
}

function NavTab({ href, label, icon, on }: { href: string; label: React.ReactNode; icon: string; on: boolean }) {
  return (
    <Link
      href={href}
      prefetch
      aria-current={on ? "page" : undefined}
      className={`relative flex flex-1 select-none flex-col items-center justify-center gap-1 py-3.5 transition-transform active:scale-[0.97] ${
        on ? "bg-[#eef3ef] text-moss-deep" : "text-ink-soft"
      }`}
    >
      {/* 現在地はうえに太いアクセント */}
      <span className={`absolute inset-x-6 top-0 h-1 rounded-b-full ${on ? "bg-moss-deep" : "bg-transparent"}`} />
      <span className="text-[28px] leading-none">{icon}</span>
      <span className="text-[14px] font-bold leading-none tracking-wide">{label}</span>
    </Link>
  );
}
