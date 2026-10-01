import { redirect } from "next/navigation";

// 旧・銘柄詳細ページ。2026-10-01 に客向けを 1 ページ化したので、一覧（詳細はシート）へ送る。
// 古いQR・ブックマーク・MOのリンクが残っていても 404 にしない。
export default function SakeDetailRedirect() {
  redirect("/");
}
