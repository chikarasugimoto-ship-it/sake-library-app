import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { buildDailyBrief, markBriefSent } from "@/lib/brief";
import { notifyOffice, notifyConfigured } from "@/lib/notify";

export const dynamic = "force-dynamic";

// スマート日報cron（vercel.json で毎日 13:30 UTC = 22:30 JST に起動）。
// 「目立ったこと」があった日だけLINEに送る。0件の日は何も送らない（沈黙）。
// 認証: Vercel Cron が付ける Authorization: Bearer <CRON_SECRET>（または ?token=）。
//       手動確認用に管理画面ログイン(staffクッキー)でも叩ける。
// 動作確認: ?dry=1 でLINEを送らず本文と件数だけ返す（送信済みキーも記録しない・安全）。
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  const qtoken = req.nextUrl.searchParams.get("token") || "";
  const okSecret = !!secret && (auth === `Bearer ${secret}` || qtoken === secret);
  if (!okSecret && !(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const brief = await buildDailyBrief();

  if (dry) {
    return NextResponse.json({
      ok: true,
      dry: true,
      events: brief.events,
      sections: brief.sections,
      configured: notifyConfigured(),
      wouldSend: brief.events > 0 && notifyConfigured(),
      text: brief.text,
    });
  }

  // 静かな日は沈黙（質重視：意味のある日だけ通知）
  if (brief.events === 0) return NextResponse.json({ ok: true, sent: false, events: 0 });

  if (!notifyConfigured()) {
    // 通知未設定＝送れない。イベントは翌日以降に持ち越し（送信済みキーを記録しない）
    return NextResponse.json({ ok: false, sent: false, events: brief.events, error: "notify_unconfigured" }, { status: 503 });
  }

  const sent = await notifyOffice(brief.text);
  // 送信に成功した時だけ「送信済み」を記録＝失敗した日のイベントは翌日の日報で再度拾われる
  if (sent) await markBriefSent(brief.keys, true);
  return NextResponse.json({ ok: sent, sent, events: brief.events, sections: brief.sections }, { status: sent ? 200 : 502 });
}
