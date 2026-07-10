import { useEffect, useRef, useState } from "react";
import {
  addPresentationFile,
  addPresentationUrl,
  getCategories,
  type Category,
  type OpenMode,
  type SourceType,
} from "@/lib/store";
import { X, Upload, Link as LinkIcon, FileText } from "lucide-react";

export function UploadModal({
  onClose,
  defaultCategory,
}: {
  onClose: () => void;
  defaultCategory?: string;
}) {
  const [mode, setMode] = useState<SourceType>("file");
  const [cats, setCats] = useState<Category[]>([]);
  const [category, setCategory] = useState<string>(defaultCategory ?? "");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [openMode, setOpenMode] = useState<OpenMode>("inline");
  const [allowDownload, setAllowDownload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      getCategories()
        .then((next) => {
          if (!cancelled) {
            setCats(next);
            setCategory((cur) => {
              if (cur && next.some((c) => c.key === cur)) return cur;
              return next[0]?.key ?? "";
            });
          }
        })
        .catch((e) => console.error(e));
    };
    refresh();
    window.addEventListener("m2:categories", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("m2:categories", refresh);
    };
  }, []);

  const pickFile = (f: File | null) => {
    setFile(f);
    if (f && !name) setName(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    try {
      if (mode === "file") {
        if (!file) return;
        await addPresentationFile({ name: name.trim(), category, file, openMode, allowDownload });
      } else {
        if (!url.trim()) return;
        await addPresentationUrl({ name: name.trim(), category, url: url.trim(), openMode, allowDownload });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl p-6 sm:p-7"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold">새 프리젠테이션 등록</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-accent transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Source type */}
        <label className="block mb-4">
          <span className="text-xs font-medium text-muted-foreground mb-1.5 block">소스 유형</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as SourceType)}
            className="w-full h-11 px-3 rounded-lg bg-input border border-border text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition"
          >
            <option value="file">파일 업로드</option>
            <option value="url">URL 입력</option>
          </select>
        </label>

        {/* File / URL input */}
        {mode === "file" ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) pickFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={[
              "mb-4 cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition",
              dragOver ? "border-brand bg-brand/10" : "border-border hover:border-brand/60 hover:bg-accent/40",
            ].join(" ")}
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*,video/*,audio/*"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-brand" />
                <span className="truncate">{file.name}</span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                <Upload className="h-7 w-7 mx-auto mb-2 text-brand" />
                파일을 드래그하거나 클릭하여 업로드
                <div className="text-xs mt-1 opacity-70">PDF, Word, Excel, PPT, 이미지 등</div>
              </div>
            )}
          </div>
        ) : (
          <label className="block mb-4">
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">URL</span>
            <div className="relative">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://... (웹페이지, 유튜브, Google Drive 링크 등)"
                className="w-full h-11 pl-9 pr-3 rounded-lg bg-input border border-border text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition"
              />
            </div>
          </label>
        )}

        {/* Category */}
        <label className="block mb-4">
          <span className="text-xs font-medium text-muted-foreground mb-1.5 block">카테고리</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-11 px-3 rounded-lg bg-input border border-border text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition"
          >
            {cats.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        {/* Name */}
        <label className="block mb-4">
          <span className="text-xs font-medium text-muted-foreground mb-1.5 block">프리젠테이션 이름</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 2025 사업 전략"
            className="w-full h-11 px-3 rounded-lg bg-input border border-border text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 transition"
          />
        </label>

        {/* Open mode */}
        <div className="mb-6">
          <span className="text-xs font-medium text-muted-foreground mb-2 block">열기 방식</span>
          <div className="flex gap-6">
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

        {/* 다운로드 허용 */}
        <div className="mb-6">
          <span className="text-xs font-medium text-muted-foreground mb-2 block">다운로드 허용</span>
          <div className="flex gap-6">
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

        {err && <p className="mb-3 text-sm text-destructive">{err}</p>}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-5 rounded-lg border border-border hover:bg-accent transition"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim() || (mode === "file" ? !file : !url.trim())}
            className="h-11 px-6 rounded-lg gradient-brand text-primary-foreground font-semibold disabled:opacity-50 hover:opacity-90 active:scale-[.98] transition"
          >
            {busy ? "등록 중..." : "등록"}
          </button>
        </div>
      </form>
    </div>
  );
}