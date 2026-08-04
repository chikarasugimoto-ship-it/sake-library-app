import Image from "next/image";

// 写真未登録時のプレースホルダ（瓶のシルエット）。photoがあれば実写真を出す
export function BottleArt({
  color,
  photoUrl,
  alt,
  size = "md",
  sizes,
  priority = false,
}: {
  color: string;
  photoUrl: string | null;
  alt: string;
  size?: "md" | "lg";
  sizes?: string; // 表示幅のヒント（最適化サイズの自動選択用）
  priority?: boolean; // 画面上部の画像だけ true（初回表示を速く）
}) {
  if (photoUrl) {
    // next/image で表示サイズに合わせてWebP/AVIFに自動リサイズ＋CDNキャッシュ。
    // className は従来と同じ（h-full w-full object-cover）＝レイアウトは不変。
    // width/height は 4:5 のアスペクト比ヒント（実寸はCSSが上書き＝レイアウトずれ防止）。
    return (
      <Image
        src={photoUrl}
        alt={alt}
        width={size === "lg" ? 520 : 420}
        height={size === "lg" ? 650 : 525}
        sizes={sizes ?? (size === "lg" ? "240px" : "(max-width: 512px) 47vw, 236px")}
        className="h-full w-full object-cover"
        priority={priority}
      />
    );
  }
  const h = size === "lg" ? 190 : 96;
  const w = Math.round(h * 0.36);
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative" style={{ width: w, height: h }}>
        <div className="absolute inset-0 rounded-t-lg rounded-b-md" style={{ background: color }} />
        <div
          className="absolute rounded-t"
          style={{ top: -h * 0.22, left: w * 0.33, width: w * 0.34, height: h * 0.24, background: color }}
        />
        <div
          className="absolute rounded-sm bg-white/90"
          style={{ top: h * 0.28, left: w * 0.12, right: w * 0.12, height: h * 0.42 }}
        />
      </div>
    </div>
  );
}
