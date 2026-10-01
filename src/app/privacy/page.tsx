export const metadata = { title: "プライバシーポリシー — 酒コレ" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-lg px-6 py-12 text-[13.5px] leading-[1.9] text-ink">
      <h1 className="text-xl font-bold">プライバシーポリシー</h1>
      <p className="mt-1 text-xs text-ink-soft">酒コレ</p>

      <section className="mt-6 space-y-2">
        <p>
          煮干しと日本酒 すぎだま（以下「当店」）は、本サービス「酒コレ」（以下「本サービス」）における
          利用者の情報を、以下のとおり取り扱います。
        </p>
      </section>

      <Block title="1. 取得する情報">
        <ul className="list-disc space-y-1 pl-5">
          <li>注文内容：お席（卓）番号・注文した銘柄・数量・サイズ（会計・提供のため）</li>
          <li>カートの内容（お客様の端末内にのみ保存）</li>
          <li>アクセスに関する技術情報（不具合解析・改善のため）</li>
        </ul>
      </Block>

      <Block title="2. 利用目的">
        <ul className="list-disc space-y-1 pl-5">
          <li>本日の日本酒の表示・おすすめの提案</li>
          <li>注文機能を利用する場合の、注文内容の処理（POS／オーダーシステムへの連携を含む）</li>
          <li>本サービスの維持・改善</li>
        </ul>
      </Block>

      <Block title="3. 第三者提供">
        <p>法令に基づく場合を除き、取得した情報を本人の同意なく第三者へ提供・販売しません。</p>
      </Block>

      <Block title="4. 外部サービスの利用">
        <p>
          本サービスは、データ保存にクラウド事業者（Vercel／Turso 等）、注文連携にスマレジを利用します。
          各社の取り扱いは各社のポリシーに従います。
        </p>
      </Block>

      <Block title="5. 保存・削除">
        <p>
          端末内のカートはブラウザの履歴消去で削除されます。以前の図鑑・LINEログイン機能（2026年10月1日に終了）で保存された
          情報の削除をご希望の場合は、下記までご連絡ください。
        </p>
      </Block>

      <Block title="6. お問い合わせ">
        <p>煮干しと日本酒 すぎだま（東京都千代田区・常盤橋）／店舗までお問い合わせください。</p>
      </Block>

      <Block title="7. 改定">
        <p>本ポリシーは必要に応じて改定することがあります。</p>
      </Block>

      <p className="mt-8 text-xs text-ink-soft">制定日：2026年6月16日 ／ 改定：2026年10月1日（図鑑・会員機能の終了）</p>
    </main>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="font-bold">{title}</h2>
      <div className="mt-1 text-[#3c3f44]">{children}</div>
    </section>
  );
}
