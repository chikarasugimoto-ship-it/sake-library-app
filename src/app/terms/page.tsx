export const metadata = { title: "利用規約 — 酒コレ" };

export default function Terms() {
  return (
    <main className="mx-auto max-w-lg px-6 py-12 text-[13.5px] leading-[1.9] text-ink">
      <h1 className="text-xl font-bold">利用規約</h1>
      <p className="mt-1 text-xs text-ink-soft">酒コレ</p>

      <Block title="1. 本サービス">
        <p>
          本サービスは、煮干しと日本酒 すぎだまが提供する、店内の日本酒の閲覧、および任意での注文を行う
          ウェブサービスです。
        </p>
      </Block>

      <Block title="2. 飲酒について（重要）">
        <ul className="list-disc space-y-1 pl-5">
          <li>20歳未満の飲酒は法律で禁止されています。</li>
          <li>本サービスは飲酒を推奨・強要するものではありません。節度ある適量の飲酒をお願いします。</li>
          <li>体調・状況に応じて、無理のない範囲でお楽しみください。</li>
        </ul>
      </Block>

      <Block title="3. 注文について">
        <p>
          注文内容はお席（卓）にひもづけてお店のレジへ送られます。会計は店内で行います。カートの内容はお客様の端末内にのみ保存され、
          履歴消去等で失われる場合があります。
        </p>
      </Block>

      <Block title="4. 禁止事項">
        <p>法令・公序良俗に反する行為、本サービスの運営を妨げる行為、他者になりすます行為などを禁止します。</p>
      </Block>

      <Block title="5. 免責">
        <p>
          当店は、本サービスの内容・在庫・表示の正確性や、中断・不具合により生じた損害について、法令上許される範囲で
          責任を負いません。
        </p>
      </Block>

      <Block title="6. 改定・準拠法">
        <p>本規約は予告なく改定することがあります。本規約は日本法に準拠します。</p>
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
