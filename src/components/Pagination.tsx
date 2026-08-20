import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";

export function Pagination({
  currentPage, totalPages, onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  // 현재 페이지 주변 숫자만 표시 (최대 5개)
  const pageNumbers: number[] = [];
  const windowSize = 5;
  let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  for (let p = start; p <= end; p++) pageNumbers.push(p);

  const btnBase = "h-8 min-w-8 px-2 rounded-lg text-sm font-medium transition flex items-center justify-center";
  const btnGhost = `${btnBase} text-muted-foreground hover:bg-accent disabled:opacity-30 disabled:pointer-events-none`;

  return (
    <div className="flex items-center justify-center gap-1 py-4 border-t border-border">
      <button
        onClick={() => onPageChange(1)}
        disabled={currentPage === 1}
        className={btnGhost}
        title="처음으로"
      >
        <ChevronsLeft className="h-4 w-4" />
      </button>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={btnGhost}
        title="이전"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pageNumbers.map(p => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={[
            btnBase,
            p === currentPage
              ? "gradient-brand text-primary-foreground"
              : "text-foreground hover:bg-accent",
          ].join(" ")}
        >
          {p}
        </button>
      ))}

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={btnGhost}
        title="다음"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        onClick={() => onPageChange(totalPages)}
        disabled={currentPage === totalPages}
        className={btnGhost}
        title="마지막으로"
      >
        <ChevronsRight className="h-4 w-4" />
      </button>
    </div>
  );
}
