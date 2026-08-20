import { useState, useEffect } from "react";
import { getPosts, deletePost, isAdmin, type Board, type Post } from "@/lib/store";
import { CrawlSettingsModal } from "./CrawlSettingsModal";
import { Pagination } from "./Pagination";
import { Settings, Bot } from "lucide-react";
import { Plus, Trash2, Edit2, ExternalLink, Image } from "lucide-react";
import { BoardWrite } from "./BoardWrite";

export function BoardCard({ board }: { board: Board }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [showCrawlSettings, setShowCrawlSettings] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 12;
  const admin = isAdmin();
  const canWrite = admin || board.allowWrite === "all";

  const load = () => {
    setLoading(true);
    getPosts(board.id)
      .then(setPosts)
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); setCurrentPage(1); }, [board.id]);

  const handleDelete = async (post: Post) => {
    if (!confirm(`"${post.title}" 게시글을 삭제하시겠습니까?`)) return;
    await deletePost(board.id, post.id);
    load();
  };

  if (writing || editing) {
    return (
      <BoardWrite
        board={board}
        post={editing || undefined}
        onClose={() => { setWriting(false); setEditing(null); load(); }}
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  const pagedPosts = posts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h2 className="font-bold text-lg">{board.name}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">총 {posts.length}개의 기사</p>
        </div>
        <div className="flex items-center gap-2">
          {admin && (
            <button
              onClick={() => setShowCrawlSettings(true)}
              className="h-9 px-3 rounded-lg border border-border hover:bg-accent transition text-sm font-medium flex items-center gap-1.5"
            >
              <Settings className="h-3.5 w-3.5" /> 자동수집
            </button>
          )}
          {canWrite && (
            <button
              onClick={() => setWriting(true)}
              className="h-9 px-4 rounded-lg gradient-brand text-primary-foreground text-sm font-semibold flex items-center gap-1.5 hover:opacity-90 transition"
            >
              <Plus className="h-4 w-4" /> 기사 추가
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="h-full grid place-items-center text-muted-foreground text-sm">불러오는 중...</div>
        ) : posts.length === 0 ? (
          <div className="h-full grid place-items-center text-center">
            <div>
              <p className="text-muted-foreground text-sm mb-2">등록된 기사가 없습니다</p>
              {canWrite && (
                <button onClick={() => setWriting(true)} className="text-brand text-sm hover:underline">
                  첫 기사 추가하기
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pagedPosts.map(post => (
              <div
                key={post.id}
                className="rounded-xl border border-border bg-card overflow-hidden hover:border-brand/40 transition group"
              >
                <div className="aspect-video bg-muted/50 relative overflow-hidden flex items-center justify-center">
                  {post.thumbnail ? (
                    <img
                      src={post.thumbnail}
                      alt={post.title}
                      className="max-w-full max-h-full object-contain group-hover:scale-105 transition duration-300"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center">
                      <Image className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  )}
                  {post.sourceName && (
                    <span className="absolute top-2 left-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded-full backdrop-blur-sm">
                      {post.sourceName}
                    </span>
                  )}
                  {admin && post.isAutoCollected === "true" && (
                    <span className="absolute top-2 right-2 text-xs bg-brand/80 text-white px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1">
                      <Bot className="h-3 w-3" /> 자동수집
                    </span>
                  )}
                </div>

                <div className="p-4">
                  <h3 className="font-semibold text-sm line-clamp-2 mb-2 leading-snug">{post.title}</h3>
                  {admin && post.isAutoCollected === "true" && post.matchedKeyword && (
                    <span className="inline-block text-[10px] text-brand bg-brand/10 px-1.5 py-0.5 rounded mb-2">
                      #{post.matchedKeyword}
                    </span>
                  )}
                  {post.content && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{post.content}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{post.createdAt}</span>
                    <div className="flex items-center gap-1">
                      {post.url && (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noreferrer"
                          className="h-7 px-2.5 flex items-center gap-1 rounded-lg bg-brand/10 text-brand text-xs font-medium hover:bg-brand/20 transition"
                          onClick={e => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" /> 원문
                        </a>
                      )}
                      {admin && (
                        <>
                          <button
                            onClick={() => setEditing(post)}
                            className="h-7 w-7 grid place-items-center rounded-lg hover:bg-accent transition"
                          >
                            <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => handleDelete(post)}
                            className="h-7 w-7 grid place-items-center rounded-lg hover:bg-destructive/20 transition"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {posts.length > 0 && (
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      )}

      {showCrawlSettings && (
        <CrawlSettingsModal boardId={board.id} onClose={() => setShowCrawlSettings(false)} />
      )}
    </div>
  );
}
