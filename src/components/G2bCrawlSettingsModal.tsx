import { useState, useEffect, useRef } from "react";
import { X, Landmark, Play, Clock, History } from "lucide-react";
import {
  getG2bRule, saveG2bRule, deleteG2bRule, runG2bNow, getG2bLogs, getG2bStatus,
  type G2bSearchScope, type G2bSwBizObjYn, type G2bCrawlLog, type G2bRunProgress,
} from "@/lib/store";

const BIZ_TYPES = ["일반용역", "기술용역", "물품"];
const SW_BIZ_OPTIONS: { value: G2bSwBizObjYn; label: string }[] = [
  { value: "", label: "전체" },
  { value: "Y", label: "SW사업 대상만" },
  { value: "N", label: "SW사업 대상 아님만" },
];

export function G2bCrawlSettingsModal({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const [enabled, setEnabled] = useState(true);
  const [keywordsInput, setKeywordsInput] = useState("");
  const [searchScope, setSearchScope] = useState<G2bSearchScope>("title");
  const [bizTypes, setBizTypes] = useState<string[]>(["일반용역", "기술용역", "물품"]);
  const [swBizObjYn, setSwBizObjYn] = useState<G2bSwBizObjYn>("Y");
  const [hour, setHour] = useState(2);
  const [minute, setMinute] = useState(0);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [logs, setLogs] = useState<G2bCrawlLog[]>([]);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<G2bRunProgress | null>(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getG2bRule(boardId).then(rule => {
      if (rule) {
        setEnabled(rule.enabled);
        setKeywordsInput(rule.keywords.join(", "));
        setSearchScope(rule.searchScope);
        setBizTypes(rule.bizTypes);
        setSwBizObjYn(rule.swBizObjYn || "");
        setHour(rule.hour);
        setMinute(rule.minute);
        setLastRunAt(rule.lastRunAt);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));

    getG2bLogs(boardId).then(setLogs).catch(() => {});
  }, [boardId]);

  const toggleBizType = (type: string) => {
    setBizTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };

  const handleSave = async () => {
    const keywords = keywordsInput.split(",").map(k => k.trim()).filter(Boolean);
    if (keywords.length === 0) { setErr("키워드를 최소 1개 입력해주세요"); return; }
    if (bizTypes.length === 0) { setErr("업무 구분을 최소 1개 선택해주세요"); return; }
    setBusy(true);
    setErr("");
    try {
      await saveG2bRule(boardId, { enabled, keywords, searchScope, bizTypes, swBizObjYn, hour, minute });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // 모달이 열릴 때 이미 실행 중인 작업이 있다면 폴링 재개 (모달을 껐다 켜도 상태 유지)
  useEffect(() => {
    getG2bStatus(boardId).then(({ running: r, progress: p }) => {
      if (r) startPolling(p);
    }).catch(() => {});
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const startPolling = (initialProgress?: G2bRunProgress | null) => {
    setRunning(true);
    setProgress(initialProgress ?? null);
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const { running: stillRunning, progress: p } = await getG2bStatus(boardId);
        if (!stillRunning) {
          stopPolling();
          setRunning(false);
          setProgress(null);
          // 완료되었으므로 이력과 마지막 실행 시각 새로고침
          const [rule, newLogs] = await Promise.all([getG2bRule(boardId), getG2bLogs(boardId)]);
          if (rule) setLastRunAt(rule.lastRunAt);
          setLogs(newLogs);
        } else {
          setProgress(p);
        }
      } catch {
        stopPolling();
        setRunning(false);
        setProgress(null);
      }
    }, 3000);
  };

  const handleRunNow = async () => {
    try {
      await runG2bNow(boardId);
      startPolling();
    } catch (e) {
      alert(e instanceof Error ? e.message : "실행 실패");
    }
  };

  const handleDelete = async () => {
    if (!confirm("자동 수집 설정을 삭제하시겠습니까?")) return;
    try {
      await deleteG2bRule(boardId);
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    }
  };

  const displayLogs = showAllLogs ? logs : logs.slice(0, 3);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="w-[440px] max-h-[85vh] overflow-y-auto rounded-2xl bg-card border border-border shadow-2xl p-5"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-brand" /> 자동 수집 설정 (나라장터 사전규격)
          </h2>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg hover:bg-accent transition">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {!loaded ? (
          <div className="py-10 text-center text-sm text-muted-foreground">불러오는 중...</div>
        ) : (
          <div className="space-y-4">

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-brand w-4 h-4" />
              <span className="text-sm font-medium">자동 수집 사용</span>
            </label>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">키워드 (쉼표로 구분)</label>
              <input
                value={keywordsInput}
                onChange={e => setKeywordsInput(e.target.value)}
                placeholder="전자서명, 전자문서, 전자결재"
                className="w-full h-9 px-3 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">검색 범위</label>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={searchScope === "title"} onChange={() => setSearchScope("title")} className="accent-brand" />
                  <span className="text-sm">공고 제목만 (빠름)</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" checked={searchScope === "title_attach"} onChange={() => setSearchScope("title_attach")} className="accent-brand" />
                  <span className="text-sm">공고 제목 + 규격서 첨부파일 내용</span>
                </label>
              </div>
              {searchScope === "title_attach" && (
                <p className="text-xs text-muted-foreground mt-1">
                  ※ 첨부파일을 다운로드하여 검색하므로 시간이 오래 걸릴 수 있습니다.
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">업무 구분</label>
              <div className="flex gap-4">
                {BIZ_TYPES.map(type => (
                  <label key={type} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bizTypes.includes(type)}
                      onChange={() => toggleBizType(type)}
                      className="accent-brand w-4 h-4"
                    />
                    <span className="text-sm">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">SW사업대상여부</label>
              <div className="flex gap-4">
                {SW_BIZ_OPTIONS.map(opt => (
                  <label key={opt.value || "all"} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={swBizObjYn === opt.value}
                      onChange={() => setSwBizObjYn(opt.value)}
                      className="accent-brand"
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1">
                <Clock className="h-3 w-3" /> 실행 시각 (매일)
              </label>
              <div className="flex gap-2">
                <select
                  value={hour}
                  onChange={e => setHour(Number(e.target.value))}
                  className="h-9 px-2 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
                >
                  {Array.from({ length: 24 }, (_, i) => i).map(h => (
                    <option key={h} value={h}>{h < 12 ? `오전 ${h === 0 ? 12 : h}시` : `오후 ${h === 12 ? 12 : h - 12}시`}</option>
                  ))}
                </select>
              </div>
            </div>

            {lastRunAt && (
              <p className="text-xs text-muted-foreground">
                마지막 실행: {new Date(lastRunAt).toLocaleString("ko-KR")}
              </p>
            )}

            <button
              onClick={handleRunNow}
              disabled={running}
              className="w-full h-9 rounded-lg border border-brand/40 text-brand text-sm font-medium hover:bg-brand/10 transition flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              {running ? (
                <>
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-brand border-t-transparent animate-spin" />
                  {progress?.phase === "processing" && progress.total > 0
                    ? `실행 중... ${progress.done}/${progress.total}건 (${Math.min(100, Math.round((progress.done / progress.total) * 100))}%)`
                    : "실행 중... (공고 목록 조회 중)"}
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" /> 지금 즉시 실행
                </>
              )}
            </button>

            {running && progress?.phase === "processing" && progress.total > 0 && (
              <div>
                <div className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className="h-full bg-brand transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%` }}
                  />
                </div>
                {progress.collected > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground text-center">
                    지금까지 {progress.collected}건 매칭됨
                  </p>
                )}
              </div>
            )}

            {logs.length > 0 && (
              <div className="border-t border-border pt-3">
                <h3 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                  <History className="h-3 w-3" /> 실행 이력
                </h3>
                <div className="space-y-2">
                  {displayLogs.map(log => (
                    <div key={log.id} className="text-xs bg-muted/20 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-muted-foreground">{new Date(log.ranAt).toLocaleString("ko-KR")}</span>
                        <span className={log.status === "success" ? "text-brand" : "text-destructive"}>
                          {log.status === "success" ? "✓ 성공" : "✗ 실패"}
                        </span>
                      </div>
                      {log.status === "success" ? (
                        <p className="text-muted-foreground">
                          {log.collected}건 등록, {log.duplicates}건 중복 제외
                          {log.collected > 0 && ` (제목 매칭 ${log.titleMatched}건, 첨부파일 매칭 ${log.attachMatched}건)`}
                        </p>
                      ) : (
                        <p className="text-destructive">{log.errorMsg}</p>
                      )}
                    </div>
                  ))}
                </div>
                {logs.length > 3 && (
                  <button
                    onClick={() => setShowAllLogs(v => !v)}
                    className="text-xs text-brand hover:underline mt-2"
                  >
                    {showAllLogs ? "접기" : `더 보기 (${logs.length - 3}개)`}
                  </button>
                )}
              </div>
            )}

            {err && <p className="text-xs text-destructive">{err}</p>}

            <div className="flex gap-2 pt-2">
              <button onClick={handleDelete} className="h-9 px-3 rounded-lg border border-destructive/30 text-destructive text-sm hover:bg-destructive/10 transition">
                삭제
              </button>
              <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-border hover:bg-accent transition text-sm font-medium">
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={busy}
                className="flex-1 h-9 rounded-lg gradient-brand text-primary-foreground text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {busy ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
