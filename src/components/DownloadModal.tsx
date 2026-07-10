import { useState } from "react";
import { X } from "lucide-react";
import { changeAllowDownload, type Presentation } from "@/lib/store";

export function DownloadModal({
  presentation,
  onClose,
}: {
  presentation: Presentation;
  onClose: () => void;
}) {
  const [allowDownload, setAllowDownload] = useState(
    presentation.allowDownload !== false
  );
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    setBusy(true);
    try {
      await changeAllowDownload(presentation.id, allowDownload);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "다운로드 설정 변경 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-64 rounded-2xl bg-card border border-border shadow-2xl p-5 animate-in zoom-in-95"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-base">다운로드 설정 변경</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded-lg hover:bg-accent transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mb-5">
          <span className="text-xs text-muted-foreground mb-2 block">다운로드 허용</span>
          <div className="flex gap-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="allowDownload"
                checked={allowDownload}
                onChange={() => setAllowDownload(true)}
                className="accent-brand w-4 h-4"
              />
              <span className="text-sm">허용</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="allowDownload"
                checked={!allowDownload}
                onChange={() => setAllowDownload(false)}
                className="accent-brand w-4 h-4"
              />
              <span className="text-sm">비허용</span>
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="w-full h-11 rounded-xl gradient-brand text-primary-foreground font-semibold hover:opacity-90 active:scale-[.98] transition disabled:opacity-50"
        >
          {busy ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
