import { ChevronLeft, Edit2, Trash2, ExternalLink, Eye, Calendar, User, Paperclip, Download, FileText, Bot } from "lucide-react";
import { parseAttachments, downloadAttachment, previewAttachment, formatFileSize, isAdmin, type Board, type Post } from "@/lib/store";

export function BoardPostView({
  board, post, onBack, onEdit, onDelete, onRefresh,
}: {
  board: Board;
  post: Post;
  onBack: () => void;
  onEdit?: (post: Post) => void;
  onDelete?: (post: Post) => Promise<void>;
  onRefresh: () => void;
}) {
  const attachments = parseAttachments(post.attachments);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <button onClick={onBack} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-accent transition shrink-0">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm text-muted-foreground truncate">{board.name}</span>
        <div className="ml-auto flex items-center gap-1">
          {onEdit && (
            <button
              onClick={() => onEdit(post)}
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg border border-border hover:bg-accent transition text-sm"
            >
              <Edit2 className="h-3.5 w-3.5" /> 수정
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(post)}
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition text-sm"
            >
              <Trash2 className="h-3.5 w-3.5" /> 삭제
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold leading-snug mb-2">{post.title}</h1>

          {isAdmin() && post.isAutoCollected === "true" && (
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-flex items-center gap-1 text-xs text-brand bg-brand/10 px-2 py-0.5 rounded-full">
                <Bot className="h-3 w-3" />
                {post.g2bMatchType === "attach" ? "자동수집 (첨부매칭)" : post.g2bMatchType === "title" ? "자동수집 (제목매칭)" : "자동수집"}
              </span>
              {post.matchedKeyword && (
                <span className="text-xs text-muted-foreground">#{post.matchedKeyword}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-6 pb-6 border-b border-border">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> {post.createdAt}
            </span>
            <span className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" /> {post.views}회
            </span>
            {post.sourceName && (
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> {post.sourceName}
              </span>
            )}
            {post.url && (
              <a
                href={post.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-brand hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> 원문 보기
              </a>
            )}
          </div>

          {post.thumbnail && (
            <div className="mb-6 rounded-xl overflow-hidden border border-border">
              <img src={post.thumbnail} alt={post.title} className="w-full object-cover" />
            </div>
          )}

          <div className="prose prose-sm max-w-none text-foreground mb-8">
            {post.content ? (
              <p className="whitespace-pre-wrap leading-relaxed">{post.content}</p>
            ) : (
              <p className="text-muted-foreground italic">내용이 없습니다.</p>
            )}
          </div>

          {/* ── 첨부파일 목록 ── */}
          {attachments.length > 0 && (
            <div className="border-t border-border pt-6">
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                <Paperclip className="h-4 w-4" /> 첨부파일 ({attachments.length})
              </h3>
              <div className="space-y-2">
                {attachments.map(att => (
                  <div
                    key={att.stored}
                    className="w-full flex items-center gap-2 pl-4 pr-2 py-3 rounded-xl border border-border hover:border-brand/40 hover:bg-accent/30 transition group"
                  >
                    {/* 문서명 영역 클릭 = 미리보기(새 탭, 브라우저 내장 뷰어) */}
                    <button
                      type="button"
                      onClick={() => previewAttachment(board.id, att)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left"
                      title="미리보기"
                    >
                      <div className="h-9 w-9 rounded-lg bg-brand/10 grid place-items-center shrink-0">
                        <FileText className="h-4 w-4 text-brand" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{att.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(att.size)}</p>
                      </div>
                    </button>
                    {/* 다운로드 아이콘 클릭 = 파일 다운로드 (미리보기와 별도 동작) */}
                    <button
                      type="button"
                      onClick={() => downloadAttachment(board.id, att).catch(() => alert("다운로드에 실패했습니다"))}
                      className="h-8 w-8 shrink-0 grid place-items-center rounded-lg hover:bg-accent transition"
                      title="다운로드"
                    >
                      <Download className="h-4 w-4 text-muted-foreground group-hover:text-brand" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
