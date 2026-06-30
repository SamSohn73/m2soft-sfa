import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isAuthed, login } from "@/lib/store";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "M2Soft SFA Project — 로그인" },
      { name: "description", content: "M2Soft SFA에 로그인하세요." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState("");
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAuthed()) navigate({ to: "/main" });
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const ok = await login(pwd);
      if (ok) {
        navigate({ to: "/main" });
      } else {
        setErr("비밀번호가 올바르지 않습니다.");
        setShake(true);
        setTimeout(() => setShake(false), 500);
      }
    } catch {
      setErr("백엔드 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden px-4">
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          background:
            "radial-gradient(600px circle at 30% 20%, oklch(0.62 0.20 255 / 0.25), transparent 60%), radial-gradient(500px circle at 70% 80%, oklch(0.72 0.18 250 / 0.18), transparent 60%)",
        }}
      />
      <form
        onSubmit={onSubmit}
        className={`relative z-10 w-full max-w-md rounded-2xl border border-border/60 bg-card/70 backdrop-blur-xl p-8 sm:p-10 glow-brand transition-transform ${
          shake ? "animate-[shake_.4s]" : ""
        }`}
      >

        <div className="flex flex-col items-center mb-8">
          <div className="h-14 w-14 rounded-2xl gradient-brand flex items-center justify-center mb-4 shadow-lg">
            <Lock className="h-6 w-6 text-primary-foreground" />
          </div>
          <img
            src="/logo_white.png"
            alt="M2SOFT"
            className="h-12 w-auto object-contain"
          />
        </div>

        <label className="block">
          <span className="sr-only">PASSWORD</span>
          <input
            type="password"
            autoFocus
            value={pwd}
            onChange={(e) => {
              setPwd(e.target.value);
              setErr("");
            }}
            placeholder="PASSWORD"
            className="w-full h-14 px-5 rounded-xl bg-input/60 border border-border text-foreground placeholder:text-muted-foreground/70 outline-none tracking-widest text-center text-lg focus:border-brand focus:ring-2 focus:ring-brand/40 transition"
          />
        </label>

        {err && <p className="mt-3 text-sm text-destructive text-center">{err}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full h-12 rounded-xl gradient-brand text-primary-foreground font-semibold tracking-wide hover:opacity-90 active:scale-[.98] transition glow-brand"
        >
          {busy ? "확인 중..." : "LOGIN"}
        </button>
      </form>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0) }
          25% { transform: translateX(-8px) }
          75% { transform: translateX(8px) }
        }
      `}</style>
    </main>
  );
}
