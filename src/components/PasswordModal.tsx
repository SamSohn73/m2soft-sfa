import { useState } from "react";
import { getPassword, setPassword } from "@/lib/store";
import { X, KeyRound } from "lucide-react";

export function PasswordModal({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ type: "err" | "ok"; text: string } | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cur !== getPassword()) {
      setMsg({ type: "err", text: "현재 비밀번호가 올바르지 않습니다." });
      return;
    }
    if (next.length < 4) {
      setMsg({ type: "err", text: "새 비밀번호는 4자 이상이어야 합니다." });
      return;
    }
    if (next !== confirm) {
      setMsg({ type: "err", text: "새 비밀번호가 일치하지 않습니다." });
      return;
    }
    setPassword(next);
    setMsg({ type: "ok", text: "비밀번호가 변경되었습니다." });
    setTimeout(onClose, 800);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand" />
            <h2 className="text-lg font-bold">비밀번호 변경</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-accent transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <input
            type="password"
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            placeholder="현재 비밀번호"
            className="w-full h-11 px-3 rounded-lg bg-input border border-border outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition"
          />
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="새 비밀번호"
            className="w-full h-11 px-3 rounded-lg bg-input border border-border outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="새 비밀번호 확인"
            className="w-full h-11 px-3 rounded-lg bg-input border border-border outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition"
          />
        </div>

        {msg && (
          <p className={`mt-3 text-sm ${msg.type === "err" ? "text-destructive" : "text-brand"}`}>
            {msg.text}
          </p>
        )}

        <button
          type="submit"
          className="mt-5 w-full h-11 rounded-lg gradient-brand text-primary-foreground font-semibold hover:opacity-90 active:scale-[.98] transition"
        >
          변경
        </button>
      </form>
    </div>
  );
}
