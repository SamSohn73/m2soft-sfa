import { useState } from "react";
import { X, Link, Image, Paperclip, FileIcon } from "lucide-react";
import {
  createPost, updatePost, deleteAttachment,
  parseAttachments, formatFileSize,
  type Board, type Post,
} from "@/lib/store";

const MAX_FILES = 3;
const MAX_SIZE = 200 * 1024 * 1024; // 200MB

export function BoardWrite({
  board, post, onClose,
}: {
  board: Board;
  post?: Post;
  onClose: () => void;
}) {
  const isCard = board.type === "card";
  const isEdit = !!post;

  const [title, setTitle] = useState(post?.title ?? "");
  const [content, setContent] = useState(post?.content ?? "");
  const [url, setUrl] = useState(post?.url ?? "");
  const [thumbnail, setThumbnail] = useState(post?.thumbnail ?? "");
  const [sourceName, setSourceName] = useState(post?.sourceName ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 기존 첨부파일 (수정 모드)
  const [existingAttachments, setExistingAttachments] = useState(
    () => parseAttachments(post?.attachments ?? "")
  );
  // 새로 추가할 파일
  const [newFiles, setNewFiles] = useState<File[]>([]);

  const totalCount = existingAttachments.length + newFiles.length;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // 같은 파일 재선택 가능하도록 초기화

    const remainSlots = MAX_FILES - totalCount;
    if (remainSlots <= 0) {
      setErr(`첨부파일은 최대 ${MAX_FILES}개까지 가능합니다`);
      return;
    }

    const tooLarge = picked.find(f => f.size > MAX_SIZE);
    if (tooLarge) {
      setErr(`"${tooLarge.name}" 파일이 200MB를 초과합니다`);
      return;
    }

    setErr("");
    setNewFiles(prev => [...prev, ...picked].slice(0, remainSlots + prev.length));
  };

  const removeNewFile = (idx: number) => {
    setNewFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const removeExistingFile = async (stored: string) => {
    if (isEdit && post) {
      // 이미 저장된 게시글이면 즉시 서버에서도 삭제
      try {
        await deleteAttachment(board.id, post.id, stored);
      } catch { /* 무시하고 로컬 상태만 갱신 */ }
    }
    setExistingAttachments(prev => prev.filter(a => a.stored !== stored));
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setErr("제목을 입력해주세요"); return; }
    setBusy(true);
    setErr("");
    try {
      if (isEdit && post) {
        // 유지할 기존 첨부파일을 원본 포맷 문자열로 재조립
        const keepRaw = existingAttachments
          .map(a => `${encodeURIComponent(a.name)}|${a.stored}|${a.size}`)
          .join(";");
        await updatePost(board.id, post.id, {
          title, content, url, thumbnail, sourceName,
          keepAttachmentsRaw: keepRaw,
          newFiles,
        });
      } else {
        await createPost(board.id, { title, content, url, thumbnail, sourceName, files: newFiles });
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <h2 className="font-bold text-lg">{isEdit ? "게시글 수정" : "새 게시글"}</h2>
        <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-accent transition">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-5">

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">제목 *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="제목을 입력하세요"
              className="w-full h-10 px-3 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
            />
          </div>

          {isCard && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1">
                  <Link className="h-3 w-3" /> 원문 URL
                </label>
                <input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full h-10 px-3 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1">
                  <Image className="h-3 w-3" /> 썸네일 이미지 URL
                </label>
                <input
                  value={thumbnail}
                  onChange={e => setThumbnail(e.target.value)}
                  placeholder="https://..."
                  className="w-full h-10 px-3 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
                />
                {thumbnail && (
                  <div className="mt-2 rounded-lg overflow-hidden border border-border h-32">
                    <img src={thumbnail} alt="미리보기" className="w-full h-full object-cover" />
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">매체명</label>
                <input
                  value={sourceName}
                  onChange={e => setSourceName(e.target.value)}
                  placeholder="조선일보, 한국경제, 매일경제 등"
                  className="w-full h-10 px-3 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
                />
              </div>
            </>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {isCard ? "요약 내용" : "내용"}
            </label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={isCard ? "기사 요약을 입력하세요" : "내용을 입력하세요"}
              rows={isCard ? 4 : 10}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition resize-none"
            />
          </div>

          {/* ── 리스트형 게시판: 파일 첨부 ── */}
          {!isCard && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1">
                <Paperclip className="h-3 w-3" /> 첨부파일 ({totalCount}/{MAX_FILES})
              </label>

              {/* 기존 첨부파일 (수정 모드) */}
              {existingAttachments.map(att => (
                <div key={att.stored} className="flex items-center gap-2 px-3 py-2 mb-1.5 rounded-lg border border-border bg-muted/20">
                  <FileIcon className="h-4 w-4 text-brand shrink-0" />
                  <span className="flex-1 text-sm truncate">{att.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(att.size)}</span>
                  <button
                    onClick={() => removeExistingFile(att.stored)}
                    className="h-6 w-6 grid place-items-center rounded hover:bg-destructive/20 transition shrink-0"
                  >
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </button>
                </div>
              ))}

              {/* 새로 추가된 파일 */}
              {newFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 mb-1.5 rounded-lg border border-brand/30 bg-brand/5">
                  <FileIcon className="h-4 w-4 text-brand shrink-0" />
                  <span className="flex-1 text-sm truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(f.size)}</span>
                  <button
                    onClick={() => removeNewFile(i)}
                    className="h-6 w-6 grid place-items-center rounded hover:bg-destructive/20 transition shrink-0"
                  >
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </button>
                </div>
              ))}

              {totalCount < MAX_FILES && (
                <label className="flex items-center justify-center gap-2 h-11 rounded-lg border border-dashed border-border hover:border-brand/50 hover:bg-accent/30 transition cursor-pointer text-sm text-muted-foreground">
                  <Paperclip className="h-4 w-4" />
                  파일 선택 (최대 {MAX_FILES}개, 파일당 200MB)
                  <input type="file" multiple className="hidden" onChange={handleFileSelect} />
                </label>
              )}
            </div>
          )}

          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
      </div>

      <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3 justify-end">
        <button onClick={onClose} className="h-10 px-5 rounded-lg border border-border hover:bg-accent transition text-sm font-medium">
          취소
        </button>
        <button
          onClick={handleSubmit}
          disabled={busy}
          className="h-10 px-5 rounded-lg gradient-brand text-primary-foreground text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
        >
          {busy ? "저장 중..." : isEdit ? "수정 완료" : "등록"}
        </button>
      </div>
    </div>
  );
}
