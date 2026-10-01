// 在庫ボードのデータ（銘柄・杯数集計）が届くまでの間に即表示される骨組み。
// タップ→即「画面が出た」体感を作るためのもの。デザインは admin の既存トーン
// （paper背景・cardカード・hairline罫線）に合わせた簡素なスケルトン。
function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-[#eceae5] ${className}`} />;
}

export default function Loading() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl pb-16">
      {/* 見出し */}
      <div className="px-6 pt-8">
        <Bar className="h-6 w-36" />
        <Bar className="mt-2 h-3.5 w-56" />
      </div>

      {/* 管理メニューのチップ列 */}
      <div className="mt-4 flex flex-wrap gap-2 px-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>

      {/* 銘柄カードのリスト */}
      <div className="mt-4 space-y-3 px-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-hairline bg-card p-4 shadow-[0_1px_3px_rgba(38,40,43,0.05)]"
          >
            <div className="flex items-center gap-3">
              <Bar className="h-14 w-14 rounded-xl" />
              <div className="min-w-0 flex-1">
                <Bar className="h-4 w-2/3" />
                <Bar className="mt-2 h-3 w-1/3" />
              </div>
              <Bar className="h-8 w-16 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
