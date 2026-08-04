"use client";

import { useEffect, useRef, useState } from "react";

const AUTH_KEY = "sksl.staff.auth"; // {name, pw} をこの端末に保存（任意）

type StaffName = { name: string; role: string };

export default function AdminLogin() {
  const [staff, setStaff] = useState<StaffName[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoLoggingIn, setAutoLoggingIn] = useState(false);
  const autoTried = useRef(false);

  async function doLogin(loginName: string, pw: string, fromAuto = false) {
    if (!loginName || !pw) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: loginName, password: pw }),
      });
      if (res.ok) {
        try {
          if (remember) localStorage.setItem(AUTH_KEY, JSON.stringify({ name: loginName, pw }));
          else localStorage.removeItem(AUTH_KEY);
        } catch {}
        window.location.assign("/admin");
        return;
      }
      if (fromAuto) {
        try { localStorage.removeItem(AUTH_KEY); } catch {}
      }
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error || "ログインできませんでした");
    } catch {
      setError("通信に失敗しました");
    }
    setBusy(false);
    setAutoLoggingIn(false);
  }

  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    // 名前一覧を取得
    fetch("/api/admin/login").then((r) => r.json()).then((j) => setStaff(j.staff || [])).catch(() => {});
    // 保存済みなら自動ログイン
    let saved: { name?: string; pw?: string } | null = null;
    try { saved = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch {}
    if (saved?.name && saved?.pw) {
      setName(saved.name);
      setAutoLoggingIn(true);
      doLogin(saved.name, saved.pw, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearSaved() {
    try { localStorage.removeItem(AUTH_KEY); } catch {}
    setName("");
    setPassword("");
    setRemember(false);
  }

  if (autoLoggingIn) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-8">
        <p className="animate-pulse text-sm text-ink-soft">{name} で自動ログイン中…</p>
        <button onClick={() => { setAutoLoggingIn(false); }} className="mt-4 text-xs text-ink-soft underline">別のスタッフでログイン</button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-8 pb-24">
      <p className="text-[11px] font-bold tracking-[0.3em] text-ink-soft">STAFF</p>
      <h1 className="mt-1 text-2xl font-bold">スタッフログイン</h1>

      {!name ? (
        <>
          <p className="mt-6 text-sm text-ink-soft">あなたの名前を選んでください</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {staff.map((s) => (
              <button
                key={s.name}
                onClick={() => { setName(s.name); setError(""); }}
                className="rounded-2xl border border-hairline bg-card px-4 py-5 text-base font-bold text-ink shadow-[0_1px_3px_rgba(38,40,43,0.05)] active:scale-[0.99]"
              >
                {s.name}
                {s.role === "admin" && <span className="ml-1 text-[10px] font-normal text-moss">管理者</span>}
              </button>
            ))}
            {staff.length === 0 && <p className="col-span-2 text-sm text-ink-soft">読み込み中…</p>}
          </div>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); doLogin(name, password); }} className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-base font-bold">{name} <span className="text-xs font-normal text-ink-soft">さん</span></p>
            <button type="button" onClick={() => { setName(""); setPassword(""); setError(""); }} className="text-xs text-ink-soft underline">名前を選び直す</button>
          </div>
          <input
            type="password"
            inputMode="text"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワード"
            className="w-full rounded-2xl border border-hairline bg-card px-5 py-4 text-base outline-none focus:border-moss"
          />
          <label className="flex items-center gap-2.5 px-1 text-sm text-ink-soft">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-5 w-5 accent-[#1e3d2f]" />
            この端末に保存して次回から自動ログイン
          </label>
          {error && <p className="text-sm text-[#b04a3a]">{error}</p>}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full rounded-full bg-moss-deep py-4 text-[15px] font-bold tracking-wider text-white disabled:opacity-40"
          >
            {busy ? "確認中..." : "入る"}
          </button>
          <button type="button" onClick={clearSaved} className="w-full text-center text-xs text-ink-soft underline">
            この端末の保存を削除
          </button>
        </form>
      )}
      <p className="mt-8 px-1 text-[11px] leading-relaxed text-ink-soft">
        ※ パスワードを保存するのはこの端末内だけです。共用・他人の端末では保存しないでください。
      </p>
    </main>
  );
}
