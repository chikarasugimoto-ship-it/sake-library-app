import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "sharp"],
  images: {
    // 写真を表示サイズに合わせてWebP/AVIFへ自動圧縮（転送量を大幅削減）
    formats: ["image/avif", "image/webp"],
    // 最適化済み画像をCDNに長期キャッシュ。写真差し替え時は ?v= が変わり別URLになるので安全
    minimumCacheTTL: 31536000,
    // 画像のCDN(Blob)配信を許可（DBのBLOBからオブジェクトストレージへ移設）
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
};

export default nextConfig;
