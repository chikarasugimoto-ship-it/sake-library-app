"use client";

import { useState } from "react";

const AUTH_KEY = "sksl.staff.auth";

// ログイン中のスタッフが自分のパスワードを変更（全員＝杉本含む）
export function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (next.length < 4) { setMsg("新しいパスワードは4文字以上にしてください"); return; }
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, newPassword: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(j.error || "変更できませんでした"); setBusy(false); return; }
      // 自動ログインの保存パスワードも更新（同じ人の保存があれば）
      try {
        const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
        if (saved && saved.name === j.name) localStorage.setItem(AUTH_KEY, JSON.stringify({ name: j.name, pw: next }));
      } catch {}
      setDone(true);
      setCurrent(""); setNext("");
    } catch { setMsg("通信に失敗しました"); }
    setBusy(false);
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setDone(false); setMsg(""); }}
        className="rounded-full border border-hairline bg-card px-3.5 py-1.5 text-[11.5px] font-bold text-moss-deep"
      >
        🔑 パスワード変更
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl bg-paper px-5 pb-8 pt-5" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-hairline" />
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-bold">パスワード変更</h2>
              <button onClick={() => setOpen(false)} className="text-sm text-ink-soft">閉じる</button>
            </div>

            {done ? (
              <div className="py-6 text-center">
                <p className="text-base font-bold text-moss-deep">✓ パスワードを変更しました</p>
                <button onClick={() => setOpen(false)} className="mt-4 text-sm text-ink-soft underline">閉じる</button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="現在のパスワード"
                  className="w-full rounded-2xl border border-hairline bg-card px-4 py-3.5 text-base outline-none focus:border-moss"
                />
                <input
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="新しいパスワード（4文字以上）"
                  className="w-full rounded-2xl border border-hairline bg-card px-4 py-3.5 text-base outline-none focus:border-moss"
                />
                {msg && <p className="text-sm text-[#b04a3a]">{msg}</p>}
                <button
                  onClick={submit}
                  disabled={busy || !current || !next}
                  className="w-full rounded-full bg-moss-deep py-4 text-[15px] font-bold tracking-wider text-white disabled:opacity-40"
                >
                  {busy ? "変更中…" : "変更する"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
