// X(Twitter)のカード画像はOGと同一でよいので画像本体は再利用し、
// route設定(runtime)はこのファイルで直接宣言する（再エクスポートだとNextが認識しない警告が出るため）。
export const runtime = "edge";
export { default, alt, size, contentType } from "./opengraph-image";
