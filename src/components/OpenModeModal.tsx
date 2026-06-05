import { useState } from "react";
import { X } from "lucide-react";
import { changeOpenMode, type OpenMode, type Presentation } from "@/lib/store";

export function OpenModeModal({
  presentation,
  onClose,
}: {
  presentation: Presentation;
  onClose: () => void;
}) {
  const [openMode, setOpenMode] = useState<OpenMode>(
    presentation.openMode ?? "inline"
  );
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    setBusy(true);
    try {
      await changeOpenMode(presentation.id, openMode);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "열기 방식 변경 실패");
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
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-base">열기 방식 변경</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded-lg hover:bg-accent transition"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Radio buttons */}
        <div className="mb-5">
          <span className="text-xs text-muted-foreground mb-2 block">열기 방식</span>
          <div className="flex gap-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="openMode"
                value="inline"
                checked={openMode === "inline"}
                onChange={() => setOpenMode("inline")}
                className="accent-brand w-4 h-4"
              />
              <span className="text-sm">기존 창</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="openMode"
                value="new_tab"
                checked={openMode === "new_tab"}
                onChange={() => setOpenMode("new_tab")}
                className="accent-brand w-4 h-4"
              />
              <span className="text-sm">새 탭</span>
            </label>
          </div>
        </div>

        {/* Save button */}
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
