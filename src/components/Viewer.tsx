import { useState, useRef, useEffect, useCallback } from "react";
import { buildViewerUrl } from "@/lib/viewer";
import type { Presentation } from "@/lib/store";
import {
  FileQuestion, Download, ExternalLink,
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Layers,
  Maximize, Minimize, RotateCcw, RotateCw,
  PanelLeft, Search, X, ArrowUp, ArrowDown,
  AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter,
} from "lucide-react";

async function triggerDownload(src: string, fileName: string) {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(src, "_blank");
  }
}

type TextItem = { str: string; transform: number[]; width: number; height: number };
type SearchMatch = { page: number; itemIndex: number; charStart: number; charEnd: number };

type PdfControls = {
  page: number; totalPages: number; scale: number; rotation: number;
  showThumbnails: boolean; showSearch: boolean;
  searchQuery: string; matchCount: number; currentMatch: number;
  prevPage: () => void; nextPage: () => void; goToPage: (p: number) => void;
  zoomIn: () => void; zoomOut: () => void;
  fitWidth: () => void; fitHeight: () => void;
  rotateLeft: () => void; rotateRight: () => void;
  toggleThumbnails: () => void; toggleSearch: () => void;
  setSearchQuery: (q: string) => void;
  prevMatch: () => void; nextMatch: () => void;
  toggleFullscreen: () => void; isFullscreen: boolean;
};

function PdfJsViewer({ url, onReady }: { url: string; onReady: (c: PdfControls) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);
  const thumbCanvasesRef = useRef<Map<number, string>>(new Map());

  // 스와이프 감지용
  const swipeTouchStartX = useRef<number | null>(null);
  const swipeTouchStartY = useRef<number | null>(null);

  // 핀치 줌 감지용
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef<number>(1);

  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [allPageTexts, setAllPageTexts] = useState<TextItem[][]>([]);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [thumbUrls, setThumbUrls] = useState<Map<number, string>>(new Map());

  // 전체화면 오버레이
  const [showFsOverlay, setShowFsOverlay] = useState(false);
  const fsOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getDistance = (touches: TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleSwipeTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStartDist.current = getDistance(e.touches as unknown as TouchList);
      pinchStartScale.current = scale;
    } else {
      swipeTouchStartX.current = e.touches[0].clientX;
      swipeTouchStartY.current = e.touches[0].clientY;
    }
  }, [scale]);

  const handleSwipeTouchEnd = useCallback((e: React.TouchEvent) => {
    // 핀치 종료
    if (pinchStartDist.current !== null) {
      pinchStartDist.current = null;
      return;
    }
    if (swipeTouchStartX.current === null || swipeTouchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeTouchStartX.current;
    const dy = e.changedTouches[0].clientY - swipeTouchStartY.current;
    swipeTouchStartX.current = null;
    swipeTouchStartY.current = null;

    // 수직 스크롤과 구분
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (Math.abs(dx) < 50) return;

    if (dx < 0) {
      // 왼쪽 스와이프 → 다음 페이지
      setPage(p => Math.min(p + 1, totalPages));
    } else {
      // 오른쪽 스와이프 → 이전 페이지
      setPage(p => Math.max(p - 1, 1));
    }
  }, [totalPages]);

  const handleFsTouch = useCallback(() => {
    setShowFsOverlay(true);
    if (fsOverlayTimerRef.current) clearTimeout(fsOverlayTimerRef.current);
    fsOverlayTimerRef.current = setTimeout(() => setShowFsOverlay(false), 3000);
  }, []);

  const calcFitScale = useCallback(async (pdfDoc: any, mode: "width" | "height" | "auto", rot: number) => {
    if (!containerRef.current || !pdfDoc) return 1;
    const p = await pdfDoc.getPage(1);
    const vp = p.getViewport({ scale: 1, rotation: rot * 90 });
    const cw = containerRef.current.clientWidth - 32;
    const ch = containerRef.current.clientHeight - 32;
    if (mode === "width") return cw / vp.width;
    if (mode === "height") return ch / vp.height;
    return Math.min(cw / vp.width, ch / vp.height);
  }, []);

  // PDF 로드
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setPage(1); setPdf(null);
    setAllPageTexts([]); setMatches([]); setCurrentMatch(0);
    setThumbUrls(new Map()); thumbCanvasesRef.current.clear();

    import("pdfjs-dist").then(async (lib) => {
      const ws = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      lib.GlobalWorkerOptions.workerSrc = ws.default;

      try {
        const doc = await lib.getDocument({ url }).promise;
        if (cancelled) return;
        setPdf(doc);
        setTotalPages(doc.numPages);
        setLoading(false);

        const texts: TextItem[][] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const pg = await doc.getPage(i);
          const tc = await pg.getTextContent();
          texts.push(tc.items as TextItem[]);
        }
        if (!cancelled) setAllPageTexts(texts);
      } catch (e: any) {
        if (!cancelled) { setError("PDF를 불러올 수 없습니다. (" + (e?.message || e) + ")"); setLoading(false); }
      }
    }).catch(() => { if (!cancelled) { setError("PDF 뷰어를 불러올 수 없습니다."); setLoading(false); } });

    return () => { cancelled = true; };
  }, [url]);

  // PDF 로드 후 초기 스케일 계산
  useEffect(() => {
    if (!pdf) return;
    const calc = async () => {
      if (!containerRef.current) return;
      const cw = containerRef.current.clientWidth - 32;
      const ch = containerRef.current.clientHeight - 32;
      if (cw <= 0 || ch <= 0) return;
      const p = await pdf.getPage(1);
      const vp = p.getViewport({ scale: 1, rotation: rotation * 90 });
      const isLandscape = vp.width > vp.height;
      const fitScale = isLandscape ? cw / vp.width : Math.min(cw / vp.width, ch / vp.height);
      setScale(Math.min(fitScale, 2.5));
    };
    requestAnimationFrame(() => requestAnimationFrame(() => calc()));
  }, [pdf, rotation]);

  // 브라우저 크기 변경 시 스케일 재계산
  useEffect(() => {
    if (!pdf) return;
    let timer: ReturnType<typeof setTimeout>;
    const handleResize = async () => {
      if (document.fullscreenElement) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (!containerRef.current || !pdf) return;
        const p = await pdf.getPage(1);
        const vp = p.getViewport({ scale: 1, rotation: rotation * 90 });
        const cw = containerRef.current.clientWidth - 32;
        const ch = containerRef.current.clientHeight - 32;
        const isLandscape = vp.width > vp.height;
        const fitScale = isLandscape ? cw / vp.width : Math.min(cw / vp.width, ch / vp.height);
        setScale(Math.min(fitScale, 2.5));
      }, 150);
    };
    window.addEventListener("resize", handleResize);
    return () => { window.removeEventListener("resize", handleResize); clearTimeout(timer); };
  }, [pdf, rotation]);

  // 검색
  useEffect(() => {
    if (!searchQuery.trim() || allPageTexts.length === 0) { setMatches([]); setCurrentMatch(0); return; }
    const q = searchQuery.toLowerCase();
    const found: SearchMatch[] = [];
    allPageTexts.forEach((items, pi) => {
      const full = items.map(i => i.str).join("");
      const lower = full.toLowerCase();
      let pos = 0, idx;
      while ((idx = lower.indexOf(q, pos)) !== -1) {
        let charCount = 0;
        for (let ii = 0; ii < items.length; ii++) {
          const end = charCount + items[ii].str.length;
          if (idx < end) { found.push({ page: pi + 1, itemIndex: ii, charStart: idx - charCount, charEnd: idx - charCount + q.length }); break; }
          charCount = end;
        }
        pos = idx + q.length;
      }
    });
    setMatches(found);
    setCurrentMatch(found.length > 0 ? 0 : -1);
    if (found.length > 0) setPage(found[0].page);
  }, [searchQuery, allPageTexts]);

  useEffect(() => {
    if (currentMatch >= 0 && matches[currentMatch]) setPage(matches[currentMatch].page);
  }, [currentMatch, matches]);

  // 페이지 렌더링
  const renderPage = useCallback(async (pdfDoc: any, pageNum: number, sc: number, rot: number) => {
    if (!canvasRef.current || !pdfDoc || sc <= 0) return;
    if (renderTaskRef.current) { renderTaskRef.current.cancel(); renderTaskRef.current = null; }

    const pdfPage = await pdfDoc.getPage(pageNum);
    const viewport = pdfPage.getViewport({ scale: sc, rotation: rot * 90 });
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    ctx.scale(dpr, dpr);

    if (overlayRef.current) { overlayRef.current.width = viewport.width; overlayRef.current.height = viewport.height; }

    const task = pdfPage.render({ canvasContext: ctx, viewport });
    renderTaskRef.current = task;
    try {
      await task.promise;

      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = "";
        textLayerRef.current.style.width = viewport.width + "px";
        textLayerRef.current.style.height = viewport.height + "px";
        const tc = await pdfPage.getTextContent();
        tc.items.forEach((item: TextItem) => {
          if (!item.str.trim()) return;
          const span = document.createElement("span");
          span.textContent = item.str;
          const [a, , , d, e, f] = item.transform;
          const [va, vb, vc, vd, ve, vf] = viewport.transform;
          const cx = va * e + vc * f + ve;
          const cy = vb * e + vd * f + vf;
          const fs = Math.sqrt(a * a + d * d) * sc;
          span.style.cssText = `position:absolute;left:${cx}px;top:${cy - fs}px;font-size:${fs}px;color:transparent;white-space:pre;cursor:text;transform-origin:0 0;`;
          textLayerRef.current!.appendChild(span);
        });
      }

      if (overlayRef.current && matches.length > 0 && allPageTexts[pageNum - 1]) {
        const octx = overlayRef.current.getContext("2d");
        if (octx) {
          const pageItems = allPageTexts[pageNum - 1];
          matches.filter(m => m.page === pageNum).forEach((m) => {
            const item = pageItems[m.itemIndex];
            if (!item) return;
            const [a, , , d, e, f] = item.transform;
            const [va, vb, vc, vd, ve, vf] = viewport.transform;
            const cx = va * e + vc * f + ve;
            const cy = vb * e + vd * f + vf;
            const fs = Math.sqrt(a * a + d * d) * sc;
            const w = item.width * sc;
            const isActive = matches[currentMatch]?.page === pageNum && matches[currentMatch]?.itemIndex === m.itemIndex;
            octx.fillStyle = isActive ? "rgba(255,140,0,0.5)" : "rgba(255,220,0,0.35)";
            octx.fillRect(cx, cy - fs, w, fs);
          });
        }
      }
    } catch (e: any) {
      if (e?.name !== "RenderingCancelledException") console.error(e);
    }
  }, [matches, currentMatch, allPageTexts]);

  useEffect(() => { if (pdf && scale > 0) renderPage(pdf, page, scale, rotation); }, [pdf, page, scale, rotation, renderPage]);

  // 썸네일 생성
  useEffect(() => {
    if (!pdf || !showThumbnails) return;
    let cancelled = false;
    (async () => {
      const newUrls = new Map<number, string>();
      for (let i = 1; i <= totalPages; i++) {
        if (cancelled) break;
        if (thumbCanvasesRef.current.has(i)) { newUrls.set(i, thumbCanvasesRef.current.get(i)!); continue; }
        const pg = await pdf.getPage(i);
        const vp = pg.getViewport({ scale: 0.15 });
        const tc = document.createElement("canvas");
        tc.width = vp.width; tc.height = vp.height;
        await pg.render({ canvasContext: tc.getContext("2d")!, viewport: vp }).promise;
        const dataUrl = tc.toDataURL();
        thumbCanvasesRef.current.set(i, dataUrl);
        newUrls.set(i, dataUrl);
        if (!cancelled) setThumbUrls(new Map(newUrls));
      }
    })();
    return () => { cancelled = true; };
  }, [pdf, showThumbnails, totalPages]);

  // 풀스크린
  useEffect(() => {
    const handler = async () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs) setShowFsOverlay(false);
      if (!pdf || !containerRef.current) return;
      await new Promise(r => setTimeout(r, 100));
      if (!containerRef.current) return;
      const p = await pdf.getPage(1);
      const vp = p.getViewport({ scale: 1, rotation: rotation * 90 });
      const target = document.fullscreenElement || viewerRef.current;
      const cw = (target as HTMLElement).clientWidth;
      const ch = (target as HTMLElement).clientHeight;
      setScale(Math.min(cw / vp.width, ch / vp.height));
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, [pdf, rotation]);

  // 키보드
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") setPage(p => Math.min(p + 1, totalPages));
      else if (e.key === "ArrowLeft" || e.key === "PageUp") setPage(p => Math.max(p - 1, 1));
      else if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); setShowSearch(v => !v); }
      else if (e.key === "Escape") setShowSearch(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [totalPages]);

  // 핀치 줌 + 전체화면 스와이프 (non-passive)
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    let fsSwipeStartX: number | null = null;
    let fsSwipeStartY: number | null = null;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // 핀치 줌 시작
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist.current = Math.sqrt(dx * dx + dy * dy);
        pinchStartScale.current = scale;
      } else if (e.touches.length === 1 && isFullscreen) {
        // 전체화면 스와이프 시작
        fsSwipeStartX = e.touches[0].clientX;
        fsSwipeStartY = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDist.current !== null) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ratio = dist / pinchStartDist.current;
        const newScale = Math.min(Math.max(pinchStartScale.current * ratio, 0.3), 3);
        setScale(newScale);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (pinchStartDist.current !== null) {
        pinchStartDist.current = null;
        return;
      }
      // 전체화면 스와이프 종료
      if (isFullscreen && fsSwipeStartX !== null && fsSwipeStartY !== null) {
        const dx = e.changedTouches[0].clientX - fsSwipeStartX;
        const dy = e.changedTouches[0].clientY - fsSwipeStartY;
        fsSwipeStartX = null;
        fsSwipeStartY = null;
        if (Math.abs(dx) >= Math.abs(dy) * 1.5 && Math.abs(dx) >= 50) {
          if (dx < 0) {
            setPage(p => Math.min(p + 1, totalPages));
          } else {
            setPage(p => Math.max(p - 1, 1));
          }
        }
      }
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [scale, isFullscreen, totalPages]);

  // 컨트롤 노출
  useEffect(() => {
    if (totalPages === 0) return;
    onReady({
      page, totalPages, scale, rotation,
      showThumbnails, showSearch,
      searchQuery, matchCount: matches.length, currentMatch,
      prevPage: () => setPage(p => Math.max(p - 1, 1)),
      nextPage: () => setPage(p => Math.min(p + 1, totalPages)),
      goToPage: (p) => setPage(Math.min(Math.max(1, p), totalPages)),
      zoomIn: () => setScale(s => Math.min(s + 0.2, 3)),
      zoomOut: () => setScale(s => Math.max(s - 0.2, 0.3)),
      fitWidth: async () => { if (pdf) setScale(await calcFitScale(pdf, "width", rotation)); },
      fitHeight: async () => { if (pdf) setScale(await calcFitScale(pdf, "height", rotation)); },
      rotateLeft: () => setRotation(r => (r + 3) % 4),
      rotateRight: () => setRotation(r => (r + 1) % 4),
      toggleThumbnails: () => setShowThumbnails(v => !v),
      toggleSearch: () => setShowSearch(v => !v),
      setSearchQuery,
      prevMatch: () => setCurrentMatch(m => (m - 1 + matches.length) % matches.length),
      nextMatch: () => setCurrentMatch(m => (m + 1) % matches.length),
      toggleFullscreen: () => {
        if (!document.fullscreenElement) viewerRef.current?.requestFullscreen();
        else document.exitFullscreen();
      },
      isFullscreen,
    });
  }, [page, totalPages, scale, rotation, showThumbnails, showSearch, searchQuery, matches, currentMatch, isFullscreen, onReady, pdf, calcFitScale]);

  if (loading) return <div className="h-full grid place-items-center text-muted-foreground text-sm">PDF 불러오는 중...</div>;
  if (error) return <div className="h-full grid place-items-center text-center px-6"><div className="text-sm text-destructive max-w-md">{error}</div></div>;

  return (
    <div ref={viewerRef} className="h-full flex bg-content relative">
      {/* 전체화면 터치 오버레이 */}
      {isFullscreen && (
        <div
          className="absolute inset-0 z-50"
          onTouchStart={(e) => { handleFsTouch(); handleSwipeTouchStart(e); }}
          onTouchEnd={handleSwipeTouchEnd}
          onClick={handleFsTouch}
        >
          {showFsOverlay && (
            <div className="absolute top-4 right-4 animate-in fade-in">
              <button
                onClick={(e) => { e.stopPropagation(); document.exitFullscreen(); }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-black/70 text-white text-sm font-medium backdrop-blur-sm border border-white/20"
              >
                <Minimize className="h-4 w-4" /> 전체화면 종료
              </button>
            </div>
          )}
        </div>
      )}

      {showThumbnails && (
        <div className="w-32 shrink-0 border-r border-border overflow-y-auto bg-card/50 flex flex-col gap-2 p-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
            <button key={n} onClick={() => setPage(n)} className={["rounded border-2 transition", n === page ? "border-brand" : "border-transparent hover:border-brand/40"].join(" ")}>
              {thumbUrls.has(n)
                ? <img src={thumbUrls.get(n)} alt={`${n}페이지`} style={{ width: "100%", height: "auto", display: "block" }} />
                : <div className="w-full h-20 bg-muted/30 grid place-items-center text-xs text-muted-foreground">{n}</div>}
              <div className="text-[10px] text-center py-0.5 text-muted-foreground">{n}</div>
            </button>
          ))}
        </div>
      )}
      <div ref={containerRef} className={["flex-1 overflow-auto flex justify-center", isFullscreen ? "p-0 items-center" : "p-4"].join(" ")} onTouchStart={handleSwipeTouchStart} onTouchEnd={handleSwipeTouchEnd}>
        <div className="relative self-start">
          <canvas ref={canvasRef} className="shadow-2xl rounded block" />
          <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none rounded" />
          <div ref={textLayerRef} className="absolute inset-0 select-text" style={{ userSelect: "text" }} />
        </div>
      </div>
    </div>
  );
}

export function Viewer({ presentation }: { presentation: Presentation | null }) {
  const [headerVisible, setHeaderVisible] = useState(false);
  const [usePdfJs, setUsePdfJs] = useState(true);
  const [pdfControls, setPdfControls] = useState<PdfControls | null>(null);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const headerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHeader = useCallback(() => {
    setHeaderVisible(true);
    if (headerTimerRef.current) clearTimeout(headerTimerRef.current);
    headerTimerRef.current = null;
    // 모바일에서만 타이머로 자동 숨김 (PC는 onMouseLeave로 숨김)
    if (window.innerWidth < 1024) {
      headerTimerRef.current = setTimeout(() => setHeaderVisible(false), 3000);
    }
  }, []);

  useEffect(() => { setUsePdfJs(true); setPdfControls(null); }, [presentation?.id]);
  useEffect(() => { if (pdfControls?.showSearch) setTimeout(() => searchInputRef.current?.focus(), 50); }, [pdfControls?.showSearch]);

  if (!presentation) {
    return (
      <div className="h-full grid place-items-center text-center px-6">
        <div className="max-w-md">
          <div className="h-20 w-20 mx-auto rounded-2xl gradient-brand grid place-items-center mb-6 glow-brand">
            <FileQuestion className="h-9 w-9 text-primary-foreground" />
          </div>
          <h2 className="text-2xl font-bold mb-2">문서를 선택하세요</h2>
          <p className="text-muted-foreground text-sm">
            좌측 사이드바에서{" "}
            <span className="text-brand font-semibold">프리젠테이션 등록</span>{" "}
            버튼을 눌러 PDF, Word, Excel, PPT, 이미지, 유튜브, Google Drive 링크 등을 추가하세요.
          </p>
        </div>
      </div>
    );
  }

  const { kind, url } = buildViewerUrl(presentation);
  const isPdf = kind === "pdf" || presentation.mime === "application/pdf";
  const showPdfJs = isPdf && usePdfJs && presentation.sourceType === "file";
  const c = pdfControls;

  return (
    <div className="h-full flex flex-col relative">
      {/* 마우스/터치 감지 영역 (최상단 16px) */}
      <div
        className="absolute top-0 left-0 right-0 h-4 z-20"
        onMouseEnter={showHeader}
        onTouchStart={showHeader}
      />
      {/* 모바일 터치 감지 영역 (더 넓은 영역) */}
      {!headerVisible && (
        <div
          className="absolute top-0 left-0 right-0 h-16 z-20 lg:hidden"
          onTouchStart={showHeader}
        />
      )}

      {/* 슬라이딩 헤더 */}
      <div
        className={["absolute top-0 left-0 right-0 z-10", "border-b border-border bg-card/95 backdrop-blur-sm shadow-md", "transition-transform duration-300 ease-in-out", headerVisible ? "translate-y-0" : "-translate-y-full"].join(" ")}
        onMouseEnter={showHeader}
        onMouseLeave={() => {
          if (headerTimerRef.current) clearTimeout(headerTimerRef.current);
          headerTimerRef.current = setTimeout(() => setHeaderVisible(false), 300);
        }}
      >
        {/* 행1: 파일명 + 버튼 */}
        <div className="flex items-center justify-between gap-3 px-5 py-2.5">
          <div className="min-w-0">
            <h2 className="font-semibold truncate text-sm">{presentation.name}</h2>
            <p className="text-xs text-muted-foreground truncate">{presentation.fileName ?? presentation.src}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isPdf && presentation.sourceType === "file" && (
              <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs">
                <button onClick={() => setUsePdfJs(true)} className={["h-7 px-2.5 flex items-center gap-1 transition", usePdfJs ? "bg-brand text-primary-foreground" : "hover:bg-accent"].join(" ")}>
                  <Layers className="h-3 w-3" /> PDF.js
                </button>
                <button onClick={() => setUsePdfJs(false)} className={["h-7 px-2.5 flex items-center gap-1 transition", !usePdfJs ? "bg-brand text-primary-foreground" : "hover:bg-accent"].join(" ")}>
                  기본
                </button>
              </div>
            )}
            {presentation.sourceType === "file" && (
              <button onClick={() => triggerDownload(presentation.src, presentation.fileName ?? presentation.name)} className="h-8 px-3 rounded-lg border border-border hover:bg-accent transition flex items-center gap-1.5 text-xs">
                <Download className="h-3.5 w-3.5" /><span className="hidden sm:inline">다운로드</span>
              </button>
            )}
            {presentation.sourceType === "url" && (
              <a href={presentation.src} target="_blank" rel="noreferrer" className="h-8 px-3 rounded-lg border border-border hover:bg-accent transition flex items-center gap-1.5 text-xs">
                <ExternalLink className="h-3.5 w-3.5" /><span className="hidden sm:inline">새 탭</span>
              </a>
            )}
          </div>
        </div>

        {/* 행2: PDF 컨트롤 */}
        {showPdfJs && c && (
          <div className="flex items-center gap-1 px-4 py-1.5 border-t border-border/40 flex-wrap">
            <button onClick={c.toggleThumbnails} title="썸네일" className={["h-7 w-7 grid place-items-center rounded transition", c.showThumbnails ? "bg-brand/20 text-brand" : "hover:bg-accent"].join(" ")}>
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
            <div className="w-px h-5 bg-border mx-0.5" />
            <button onClick={c.prevPage} disabled={c.page <= 1} className="h-7 w-7 grid place-items-center rounded hover:bg-accent transition disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            {pageInput !== null ? (
              <input autoFocus type="number" value={pageInput}
                onChange={e => setPageInput(e.target.value)}
                onBlur={() => { if (pageInput) c.goToPage(Number(pageInput)); setPageInput(null); }}
                onKeyDown={e => { if (e.key === "Enter") { if (pageInput) c.goToPage(Number(pageInput)); setPageInput(null); } if (e.key === "Escape") setPageInput(null); }}
                className="w-12 h-7 text-center text-xs bg-input border border-brand rounded outline-none" />
            ) : (
              <button onClick={() => setPageInput(String(c.page))} className="h-7 px-2 rounded hover:bg-accent transition text-xs">
                <span className="font-medium text-foreground">{c.page}</span><span className="text-muted-foreground"> / {c.totalPages}</span>
              </button>
            )}
            <button onClick={c.nextPage} disabled={c.page >= c.totalPages} className="h-7 w-7 grid place-items-center rounded hover:bg-accent transition disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            <div className="w-px h-5 bg-border mx-0.5" />
            <button onClick={c.rotateLeft} title="왼쪽 회전" className="h-7 w-7 grid place-items-center rounded hover:bg-accent transition"><RotateCcw className="h-3.5 w-3.5" /></button>
            <button onClick={c.rotateRight} title="오른쪽 회전" className="h-7 w-7 grid place-items-center rounded hover:bg-accent transition"><RotateCw className="h-3.5 w-3.5" /></button>
            <div className="w-px h-5 bg-border mx-0.5" />
            <button onClick={c.fitWidth} title="너비 맞춤" className="h-7 w-7 grid place-items-center rounded hover:bg-accent transition"><AlignHorizontalJustifyCenter className="h-3.5 w-3.5" /></button>
            <button onClick={c.fitHeight} title="높이 맞춤" className="h-7 w-7 grid place-items-center rounded hover:bg-accent transition"><AlignVerticalJustifyCenter className="h-3.5 w-3.5" /></button>
            <button onClick={c.toggleFullscreen} title="전체화면" className="h-7 w-7 grid place-items-center rounded hover:bg-accent transition">
              {c.isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
            </button>
            <div className="w-px h-5 bg-border mx-0.5" />
            <button onClick={c.toggleSearch} title="검색 (Ctrl+F)" className={["h-7 w-7 grid place-items-center rounded transition", c.showSearch ? "bg-brand/20 text-brand" : "hover:bg-accent"].join(" ")}><Search className="h-3.5 w-3.5" /></button>
            <div className="w-px h-5 bg-border mx-0.5" />
            <button onClick={c.zoomOut} className="h-7 w-7 grid place-items-center rounded hover:bg-accent transition"><ZoomOut className="h-3.5 w-3.5" /></button>
            <span className="text-xs text-muted-foreground w-9 text-center">{Math.round(c.scale * 100)}%</span>
            <button onClick={c.zoomIn} className="h-7 w-7 grid place-items-center rounded hover:bg-accent transition"><ZoomIn className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {/* 행3: 검색 바 */}
        {showPdfJs && c?.showSearch && (
          <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border/40">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input ref={searchInputRef} value={c.searchQuery} onChange={e => c.setSearchQuery(e.target.value)}
              placeholder="검색어 입력..."
              className="flex-1 h-7 px-2 text-xs bg-input border border-border rounded outline-none focus:border-brand" />
            {c.matchCount > 0 && <span className="text-xs text-muted-foreground shrink-0">{c.currentMatch + 1} / {c.matchCount}</span>}
            {c.searchQuery && c.matchCount === 0 && <span className="text-xs text-destructive shrink-0">결과 없음</span>}
            <button onClick={c.prevMatch} disabled={c.matchCount === 0} className="h-6 w-6 grid place-items-center rounded hover:bg-accent transition disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
            <button onClick={c.nextMatch} disabled={c.matchCount === 0} className="h-6 w-6 grid place-items-center rounded hover:bg-accent transition disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
            <button onClick={c.toggleSearch} className="h-6 w-6 grid place-items-center rounded hover:bg-accent transition"><X className="h-3 w-3" /></button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 bg-content">
        {showPdfJs ? <PdfJsViewer url={presentation.src} onReady={setPdfControls} /> : <ViewerBody kind={kind} url={url} presentation={presentation} />}
      </div>
    </div>
  );
}

function ViewerBody({ kind, url, presentation }: { kind: ReturnType<typeof buildViewerUrl>["kind"]; url: string; presentation: Presentation; }) {
  if (kind === "image") {
    return (
      <div className="w-full flex items-center justify-center p-4" style={{ height: "100%", overflow: "auto" }}>
        <img src={url} alt={presentation.name} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain" }} className="rounded-lg shadow-2xl" />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="w-full bg-black flex items-center justify-center" style={{ height: "100%", overflow: "hidden" }}>
        <video src={url} controls style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", display: "block" }} />
      </div>
    );
  }
  if (kind === "audio") return <div className="h-full w-full grid place-items-center p-6"><audio src={url} controls className="w-full max-w-xl" /></div>;
  if (kind === "office" && presentation.sourceType === "file") return (
    <div className="h-full w-full grid place-items-center text-center p-8">
      <div className="max-w-md">
        <FileQuestion className="h-12 w-12 mx-auto text-brand mb-4" />
        <h3 className="font-semibold mb-2">Office 파일은 다운로드 후 확인해주세요</h3>
        <p className="text-sm text-muted-foreground mb-5">로컬 업로드된 Word/Excel/PPT 파일은 브라우저에서 직접 미리보기가 제한됩니다.</p>
        <a href={url} download={presentation.fileName} className="inline-flex h-11 px-5 rounded-lg gradient-brand text-primary-foreground font-semibold items-center gap-2">
          <Download className="h-4 w-4" /> 파일 다운로드
        </a>
      </div>
    </div>
  );
  return <iframe src={url} title={presentation.name} className="h-full w-full border-0" allow="autoplay; encrypted-media; fullscreen" allowFullScreen />;
}
