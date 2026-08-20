import { useState, useEffect } from "react";
import { X, Settings, Play, Clock, History } from "lucide-react";
import {
  getCrawlRule, saveCrawlRule, deleteCrawlRule, runCrawlNow, getCrawlLogs,
  type ScheduleType, type CrawlLog, type SearchScope,
} from "@/lib/store";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function CrawlSettingsModal({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const [enabled, setEnabled] = useState(true);
  const [keywordsInput, setKeywordsInput] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(6); // 토요일
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(23);
  const [minute, setMinute] = useState(0);
  const [maxPerRun, setMaxPerRun] = useState(100);
  const [maxInitialBackfill, setMaxInitialBackfill] = useState(100);
  const [searchScope, setSearchScope] = useState<SearchScope>("title_content");
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [logs, setLogs] = useState<CrawlLog[]>([]);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getCrawlRule(boardId).then(rule => {
      if (rule) {
        setEnabled(rule.enabled);
        setKeywordsInput(rule.keywords.join(", "));
        setScheduleType(rule.scheduleType);
        setDayOfWeek(rule.dayOfWeek);
        setDayOfMonth(rule.dayOfMonth);
        setHour(rule.hour);
        setMinute(rule.minute);
        setMaxPerRun(rule.maxPerRun);
        setMaxInitialBackfill(rule.maxInitialBackfill);
        setSearchScope(rule.searchScope || "title_content");
        setLastRunAt(rule.lastRunAt);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));

    getCrawlLogs(boardId).then(setLogs).catch(() => {});
  }, [boardId]);

  const handleSave = async () => {
    const keywords = keywordsInput.split(",").map(k => k.trim()).filter(Boolean);
    if (keywords.length === 0) { setErr("키워드를 최소 1개 입력해주세요"); return; }
    setBusy(true);
    setErr("");
    try {
      await saveCrawlRule(boardId, {
        enabled, keywords, scheduleType, dayOfWeek, dayOfMonth, hour, minute,
        maxPerRun, maxInitialBackfill, searchScope,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    try {
      await runCrawlNow(boardId);
      alert("크롤링이 시작되었습니다. 잠시 후 게시판을 새로고침 해주세요.");
    } catch (e) {
      alert(e instanceof Error ? e.message : "실행 실패");
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("자동 수집 설정을 삭제하시겠습니까?")) return;
    try {
      await deleteCrawlRule(boardId);
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
        className="w-[420px] max-h-[85vh] overflow-y-auto rounded-2xl bg-card border border-border shadow-2xl p-5"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-base flex items-center gap-2">
            <Settings className="h-4 w-4 text-brand" /> 자동 수집 설정
          </h2>
          <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg hover:bg-accent transition">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {!loaded ? (
          <div className="py-10 text-center text-sm text-muted-foreground">불러오는 중...</div>
        ) : (
          <div className="space-y-4">

            {/* 사용 여부 */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-brand w-4 h-4" />
              <span className="text-sm font-medium">자동 수집 사용</span>
            </label>

            {/* 키워드 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">키워드 (쉼표로 구분)</label>
              <input
                value={keywordsInput}
                onChange={e => setKeywordsInput(e.target.value)}
                placeholder="전자문서, SFA, 스마트폼"
                className="w-full h-9 px-3 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
              />
            </div>

            {/* 검색 범위 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">검색 범위</label>
              <div className="flex gap-3">
                {([["title", "제목만"], ["title_content", "제목 + 내용"]] as [SearchScope, string][]).map(([val, label]) => (
                  <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={searchScope === val} onChange={() => setSearchScope(val)} className="accent-brand" />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 실행 주기 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block flex items-center gap-1">
                <Clock className="h-3 w-3" /> 실행 주기
              </label>
              <div className="flex gap-3 mb-2">
                {([["daily", "매일"], ["weekly", "매주"], ["monthly", "매월"]] as [ScheduleType, string][]).map(([val, label]) => (
                  <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={scheduleType === val} onChange={() => setScheduleType(val)} className="accent-brand" />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>

              <div className="flex gap-2">
                {scheduleType === "weekly" && (
                  <select
                    value={dayOfWeek}
                    onChange={e => setDayOfWeek(Number(e.target.value))}
                    className="h-9 px-2 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
                  >
                    {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}요일</option>)}
                  </select>
                )}
                {scheduleType === "monthly" && (
                  <select
                    value={dayOfMonth}
                    onChange={e => setDayOfMonth(Number(e.target.value))}
                    className="h-9 px-2 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}일</option>)}
                  </select>
                )}
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

            {/* 수집 개수 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">1회당 최대 수집 개수 상한 (정기/즉시 실행 시)</label>
              <select
                value={maxPerRun}
                onChange={e => setMaxPerRun(Number(e.target.value))}
                className="w-full h-9 px-3 rounded-lg border border-border bg-input text-sm outline-none focus:border-brand transition"
              >
                {[20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n}개</option>)}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                ※ 정기/즉시 실행 시에는 게시판에 마지막으로 자동수집된 기사 날짜 이후의 새 기사를 모두 가져오며, 이 값은 과도한 수집을 막는 안전 상한선입니다
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                ※ 최초 실행 시에는 최근 10개년치를 각각 검색하여, 가장 오래된 기사부터 최대 {maxInitialBackfill}개까지 수집됩니다
              </p>
            </div>

            {lastRunAt && (
              <p className="text-xs text-muted-foreground">
                마지막 실행: {new Date(lastRunAt).toLocaleString("ko-KR")}
              </p>
            )}

            {/* 즉시 실행 */}
            <button
              onClick={handleRunNow}
              disabled={running}
              className="w-full h-9 rounded-lg border border-brand/40 text-brand text-sm font-medium hover:bg-brand/10 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" /> {running ? "실행 중..." : "지금 즉시 실행"}
            </button>

            {/* 실행 이력 */}
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
                        <p className="text-muted-foreground">{log.collected}건 등록, {log.duplicates}건 중복 제외</p>
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
