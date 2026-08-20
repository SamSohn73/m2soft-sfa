import { useState, useEffect } from "react";
import { getPosts, deletePost, isAdmin, parseAttachments, type Board, type Post } from "@/lib/store";
import { Plus, Trash2, Edit2, Eye, Paperclip } from "lucide-react";
import { BoardWrite } from "./BoardWrite";
import { BoardPostView } from "./BoardPostView";
import { Pagination } from "./Pagination";

export function BoardList({ board }: { board: Board }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [viewing, setViewing] = useState<Post | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 20;
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

  if (viewing) {
    return (
      <BoardPostView
        board={board}
        post={viewing}
        onBack={() => setViewing(null)}
        onEdit={admin ? (p) => { setViewing(null); setEditing(p); } : undefined}
        onDelete={admin ? async (p) => { await handleDelete(p); setViewing(null); } : undefined}
        onRefresh={load}
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
          <p className="text-xs text-muted-foreground mt-0.5">
            총 {posts.length}개의 게시글
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setWriting(true)}
            className="h-9 px-4 rounded-lg gradient-brand text-primary-foreground text-sm font-semibold flex items-center gap-1.5 hover:opacity-90 transition"
          >
            <Plus className="h-4 w-4" /> 글쓰기
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="h-full grid place-items-center text-muted-foreground text-sm">불러오는 중...</div>
        ) : posts.length === 0 ? (
          <div className="h-full grid place-items-center text-center">
            <div>
              <p className="text-muted-foreground text-sm mb-2">게시글이 없습니다</p>
              {canWrite && (
                <button onClick={() => setWriting(true)} className="text-brand text-sm hover:underline">
                  첫 게시글 작성하기
                </button>
              )}
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 sticky top-0">
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs text-muted-foreground font-medium w-12">번호</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground font-medium">제목</th>
                <th className="px-4 py-3 text-left text-xs text-muted-foreground font-medium w-28 hidden sm:table-cell">작성일</th>
                <th className="px-4 py-3 text-center text-xs text-muted-foreground font-medium w-16 hidden sm:table-cell">
                  <Eye className="h-3 w-3 mx-auto" />
                </th>
                {admin && <th className="px-4 py-3 w-16" />}
              </tr>
            </thead>
            <tbody>
              {pagedPosts.map((post, i) => {
                const attCount = parseAttachments(post.attachments).length;
                return (
                  <tr
                    key={post.id}
                    className="border-b border-border/50 hover:bg-accent/40 transition cursor-pointer"
                    onClick={() => setViewing(post)}
                  >
                    <td className="px-4 py-3 text-muted-foreground text-center">{posts.length - ((currentPage - 1) * PAGE_SIZE) - i}</td>
                    <td className="px-4 py-3 font-medium truncate max-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{post.title}</span>
                        {attCount > 0 && (
                          <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{post.createdAt}</td>
                    <td className="px-4 py-3 text-muted-foreground text-center hidden sm:table-cell">{post.views}</td>
                    {admin && (
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => setEditing(post)}
                            className="h-6 w-6 grid place-items-center rounded hover:bg-accent transition"
                          >
                            <Edit2 className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => handleDelete(post)}
                            className="h-6 w-6 grid place-items-center rounded hover:bg-destructive/20 transition"
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {posts.length > 0 && (
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      )}
    </div>
  );
}
