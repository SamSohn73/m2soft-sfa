import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";
import geoip from "geoip-lite";
import axios from "axios";
import { execFile } from "child_process";
import * as cheerio from "cheerio";
import cron from "node-cron";
import pdfParse from "pdf-parse";
import archiver from "archiver";
import { PDFDocument } from "pdf-lib";
import AdmZip from "adm-zip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const LOG_DIR = path.join(__dirname, "logs");
const CSV_PATH = path.join(DATA_DIR, "presentations.csv");
const CATS_PATH = path.join(DATA_DIR, "categories.json");
// 로그 파일은 날짜별로 분리 생성한다 (access-YYYY-MM-DD.log 등). 파일 하나가
// 무한정 커지는 걸 막고, 특정 날짜의 로그만 빠르게 찾아볼 수 있게 하기 위함.
// 서버가 자정을 넘겨 계속 떠 있어도 다음 로그 기록 시점에 자동으로 새 날짜
// 파일로 넘어가도록, 경로를 상수로 고정하지 않고 기록할 때마다 계산한다.
const ACCESS_LOG_BASENAME = "access";
const DEBUG_LOG_BASENAME = "debug";
const G2B_DEBUG_LOG_BASENAME = "g2b_debug";
const LOG_ARCHIVE_DIR = path.join(LOG_DIR, "archive");

const PORT = Number(process.env.PORT) || 4000;

const PWD_PATH = path.join(DATA_DIR, "passwords.json");

const DEFAULT_PASSWORDS = {
  sales: { admin: "2188sm", viewer: "2188s" },
  eng:   { admin: "2188em", viewer: "2188e" },
};

// ------- 디렉토리 초기화 -------
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(LOG_ARCHIVE_DIR, { recursive: true });

// ------- 로깅 -------
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ` +
         `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function getDateStr() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
}

// 오늘 날짜 기준 로그 파일 경로를 계산한다 (예: logs/access-2026-08-24.log).
function getDatedLogPath(baseName) {
  return path.join(LOG_DIR, `${baseName}-${getDateStr()}.log`);
}

function getGeoInfo(ip) {
  try {
    const cleanIp = ip === "::1" || ip === "127.0.0.1" ? "127.0.0.1" : ip.replace(/^::ffff:/, "");
    if (cleanIp === "127.0.0.1" || cleanIp.startsWith("192.168.") ||
        cleanIp.startsWith("10.") || cleanIp.startsWith("172.")) {
      return "내부망";
    }
    const geo = geoip.lookup(cleanIp);
    if (!geo) return "알 수 없음";
    const parts = [geo.country];
    if (geo.city) parts.push(geo.city);
    if (geo.org) parts.push(geo.org.replace(/^AS\d+\s+/, ""));
    return parts.join(" ");
  } catch {
    return "알 수 없음";
  }
}

function getBrowserInfo(userAgent) {
  if (!userAgent) return "알 수 없음";
  let browser = "기타";
  let os = "기타";

  if (userAgent.includes("Edg/")) browser = "Edge";
  else if (userAgent.includes("Chrome/")) browser = "Chrome";
  else if (userAgent.includes("Firefox/")) browser = "Firefox";
  else if (userAgent.includes("Safari/")) browser = "Safari";

  const versionMatch = userAgent.match(/(Chrome|Firefox|Edg|Safari)\/(\d+)/);
  if (versionMatch) browser += ` ${versionMatch[2]}`;

  if (userAgent.includes("Windows")) os = "Windows";
  else if (userAgent.includes("Mac OS X")) os = "MacOS";
  else if (userAgent.includes("Linux")) os = "Linux";
  else if (userAgent.includes("Android")) os = "Android";
  else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) os = "iOS";

  return `${browser} ${os}`;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "알 수 없음";
}

function writeLog(filePath, line) {
  try {
    fs.appendFileSync(filePath, line + "\n", "utf8");
  } catch {}
}

function logDebug(req, statusCode, ms) {
  const ip = getClientIp(req);
  const line = `${getTimestamp()} | ${req.method} ${req.path} | ${ip} | ${statusCode} | ${ms}ms`;
  writeLog(getDatedLogPath(DEBUG_LOG_BASENAME), line);
}

function logAccess(req, action, detail = "") {
  const ip = getClientIp(req);
  const geo = getGeoInfo(ip);
  const browser = getBrowserInfo(req.headers["user-agent"]);
  const team = req.team || "-";
  const role = req.role || "-";
  const detailStr = detail ? ` | ${detail}` : "";
  const line = `${getTimestamp()} | ${ip} | ${geo} | ${team}/${role} | ${browser} | ${action}${detailStr}`;
  writeLog(getDatedLogPath(ACCESS_LOG_BASENAME), line);
}

// 나라장터(G2B) 크롤링 전용 디버그 로그. access.log/debug.log는 HTTP 요청만 기록하므로,
// 외부 API(data.go.kr) 호출 실패 시 실제 상태 코드/응답 본문을 별도 파일에 남겨
// 서버 콘솔을 직접 보지 않고도(예: 원격에서) 원인을 추적할 수 있게 한다.
function logG2b(line) {
  writeLog(getDatedLogPath(G2B_DEBUG_LOG_BASENAME), `${getTimestamp()} | ${line}`);
}

// 날짜별 로그 파일이 무한정 쌓이는 걸 막기 위한 월별 압축 보관.
// "YYYY-MM" 하나를 받아 그 달의 access/debug/g2b_debug 날짜별 로그 파일들을
// logs/archive/logs-YYYY-MM.zip 하나로 묶은 뒤, zip이 정상 생성된 걸 확인하고 나서만
// 원본 날짜별 파일들을 삭제한다 (압축 실패 시 원본을 그대로 보존해 로그 유실을 막는다).
// 이미 그 달의 zip이 있으면(=이미 처리됨) 조용히 건너뛴다.
async function archiveLogsForMonth(yyyyMM) {
  try {
    const pattern = new RegExp(`^(?:${ACCESS_LOG_BASENAME}|${DEBUG_LOG_BASENAME}|${G2B_DEBUG_LOG_BASENAME})-${yyyyMM}-\\d{2}\\.log$`);
    const files = fs.readdirSync(LOG_DIR).filter((f) => pattern.test(f));
    if (files.length === 0) return;

    const zipPath = path.join(LOG_ARCHIVE_DIR, `logs-${yyyyMM}.zip`);
    if (fs.existsSync(zipPath)) return; // 이미 압축됨

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", resolve);
      archive.on("error", reject);
      archive.pipe(output);
      for (const f of files) {
        archive.file(path.join(LOG_DIR, f), { name: f });
      }
      archive.finalize();
    });

    if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size === 0) {
      throw new Error("zip 파일 생성 확인 실패");
    }

    for (const f of files) {
      try { fs.unlinkSync(path.join(LOG_DIR, f)); } catch { /* 무시 */ }
    }

    const line = `${getTimestamp()} | 로그 아카이브 완료: ${yyyyMM} (${files.length}개 파일 → ${path.basename(zipPath)})`;
    console.log(line);
    writeLog(getDatedLogPath(DEBUG_LOG_BASENAME), line);
  } catch (e) {
    const line = `${getTimestamp()} | 로그 아카이브 실패: ${yyyyMM} - ${e?.message || e}`;
    console.error(line);
    writeLog(getDatedLogPath(DEBUG_LOG_BASENAME), line);
  }
}

// 방금 끝난 "지난 달"을 압축한다. 말일 23:59에 실행하면 그날 마지막 몇 분의 로그가
// 아직 기록되는 중일 수 있어 누락 위험이 있으므로, 안전하게 다음 달 1일 00:10에
// 실행해서 이미 완전히 끝난 지난 달 전체를 압축한다.
function archivePreviousMonthLogs() {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yyyyMM = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  archiveLogsForMonth(yyyyMM);
}

// 서버가 말일 근처에 꺼져있어 위 스케줄을 못 탄 경우를 대비한 안전장치.
// 서버 시작 시 날짜별 로그 파일들을 스캔해서, 이번 달이 아닌(=이미 끝난) 달인데
// 아직 압축되지 않은 게 있으면 압축한다. archiveLogsForMonth 자체가 이미 압축된
// 달은 건너뛰므로 여러 번 호출돼도 안전하다.
function archiveAllPastMonths() {
  try {
    const re = new RegExp(`^(?:${ACCESS_LOG_BASENAME}|${DEBUG_LOG_BASENAME}|${G2B_DEBUG_LOG_BASENAME})-(\\d{4}-\\d{2})-\\d{2}\\.log$`);
    const monthSet = new Set();
    for (const f of fs.readdirSync(LOG_DIR)) {
      const m = f.match(re);
      if (m) monthSet.add(m[1]);
    }
    const currentYyyyMM = getDateStr().slice(0, 7);
    for (const yyyyMM of monthSet) {
      if (yyyyMM !== currentYyyyMM) archiveLogsForMonth(yyyyMM);
    }
  } catch (e) {
    console.error("로그 아카이브 대상 확인 실패:", e?.message || e);
  }
}

// ------- Password helpers -------
function readPasswords() {
  try {
    if (fs.existsSync(PWD_PATH)) {
      const raw = JSON.parse(fs.readFileSync(PWD_PATH, "utf8"));
      const migrated = {};
      let needsWrite = false;
      for (const team of ["sales", "eng"]) {
        const v = raw?.[team];
        if (v && typeof v === "object" && typeof v.admin === "string" && typeof v.viewer === "string") {
          migrated[team] = { admin: v.admin, viewer: v.viewer };
        } else if (typeof v === "string") {
          migrated[team] = { admin: DEFAULT_PASSWORDS[team].admin, viewer: v };
          needsWrite = true;
        } else {
          migrated[team] = { ...DEFAULT_PASSWORDS[team] };
          needsWrite = true;
        }
      }
      if (needsWrite) {
        try { fs.writeFileSync(PWD_PATH, JSON.stringify(migrated, null, 2), "utf8"); } catch {}
      }
      return migrated;
    }
  } catch {}
  return {
    sales: {
      admin:  process.env.APP_PASSWORD_SALES_ADMIN  || DEFAULT_PASSWORDS.sales.admin,
      viewer: process.env.APP_PASSWORD_SALES        || DEFAULT_PASSWORDS.sales.viewer,
    },
    eng: {
      admin:  process.env.APP_PASSWORD_ENG_ADMIN    || DEFAULT_PASSWORDS.eng.admin,
      viewer: process.env.APP_PASSWORD_ENG          || DEFAULT_PASSWORDS.eng.viewer,
    },
  };
}

function writePasswords(data) {
  fs.writeFileSync(PWD_PATH, JSON.stringify(data, null, 2), "utf8");
}

const TEAMS = ["sales", "eng"];
const ROLES = ["admin", "viewer"];

function teamForPassword(pwd) {
  if (!pwd) return null;
  const pwds = readPasswords();
  for (const t of TEAMS) {
    for (const r of ROLES) {
      if (pwds[t]?.[r] === pwd) return { team: t, role: r };
    }
  }
  return null;
}

// ------- CSV helpers -------
const DEFAULT_CATEGORIES = [
  { key: "company", label: "회사소개" },
  { key: "strategy", label: "전략기획" },
  { key: "product", label: "제품기획" },
  { key: "sales_cat", label: "영업자료" },
  { key: "reference", label: "참고자료" },
  { key: "education", label: "교육자료" },
];

const CSV_HEADERS = [
  "id", "name", "category", "sourceType",
  "src", "mime", "fileName", "createdAt", "team", "openMode", "allowDownload",
];

if (!fs.existsSync(CSV_PATH)) {
  fs.writeFileSync(CSV_PATH, csvStringify([CSV_HEADERS]), "utf8");
}
if (!fs.existsSync(CATS_PATH)) {
  fs.writeFileSync(CATS_PATH, JSON.stringify({}), "utf8");
}

let chain = Promise.resolve();
function serialize(task) {
  const next = chain.then(task, task);
  chain = next.catch(() => {});
  return next;
}

function readAll() {
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rows = csvParse(text, { columns: true, skip_empty_lines: true });
  return rows.map((r) => ({
    id: r.id, name: r.name, category: r.category,
    sourceType: r.sourceType, src: r.src,
    mime: r.mime || undefined, fileName: r.fileName || undefined,
    createdAt: Number(r.createdAt) || 0, team: r.team || "",
    openMode: r.openMode || "inline",
    allowDownload: r.allowDownload !== "false",
  }));
}

function writeAll(list) {
  const out = [CSV_HEADERS, ...list.map((p) => CSV_HEADERS.map((h) => {
    const val = p[h];
    return val === undefined || val === null ? "" : String(val);
  }))];
  fs.writeFileSync(CSV_PATH, csvStringify(out), "utf8");
}

// ------- Category helpers -------
function readAllCats() {
  try {
    return JSON.parse(fs.readFileSync(CATS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeAllCats(data) {
  fs.writeFileSync(CATS_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getCatsForTeam(team) {
  const all = readAllCats();
  if (all[team] && all[team].length > 0) return all[team];
  return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}

// One-time migration
(function migrateTeams() {
  try {
    const list = readAll();
    const orphans = list.filter((p) => !p.team);
    if (orphans.length === 0) return;
    const kept = list.filter((p) => !!p.team);
    for (const o of orphans) {
      TEAMS.forEach((team, idx) => {
        if (idx === 0) kept.push({ ...o, team });
        else kept.push({ ...o, id: crypto.randomUUID(), team });
      });
    }
    writeAll(kept);
    console.log(`[migrate] duplicated ${orphans.length} row(s) across teams: ${TEAMS.join(", ")}`);
  } catch (e) {
    console.error("[migrate] failed:", e);
  }
})();

// ------- Express -------
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// debug.log 미들웨어
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logDebug(req, res.statusCode, Date.now() - start);
  });
  next();
});

function requirePassword(req, res, next) {
  const auth = teamForPassword(req.header("x-app-password"));
  if (!auth) return res.status(401).json({ error: "unauthorized" });
  req.team = auth.team;
  req.role = auth.role;
  next();
}

function requireAdmin(req, res, next) {
  if (req.role !== "admin") return res.status(403).json({ error: "forbidden" });
  next();
}

function publicizeFileSrc(req, p) {
  if (p.sourceType !== "file") return p;
  const base = `${req.protocol}://${req.get("host")}`;
  const pwd = req.header("x-app-password") || "";
  const qs = pwd ? `?pwd=${encodeURIComponent(pwd)}` : "";
  return { ...p, src: `${base}/api/files/${p.id}${qs}` };
}

// --- Auth ---
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  const auth = teamForPassword(password);
  if (auth) {
    req.team = auth.team;
    req.role = auth.role;
    logAccess(req, "LOGIN_SUCCESS");
    return res.json({ ok: true, team: auth.team, role: auth.role });
  }
  req.team = "-";
  req.role = "-";
  logAccess(req, "LOGIN_FAIL");
  return res.status(401).json({ ok: false });
});

app.post("/api/change-password", requirePassword, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "invalid" });
    }
    const trimmed = String(newPassword).trim();
    if (trimmed.length < 4) {
      return res.status(400).json({ error: "invalid" });
    }
    const pwds = readPasswords();
    if (pwds[req.team]?.[req.role] !== String(currentPassword)) {
      return res.status(400).json({ error: "invalid" });
    }
    for (const t of TEAMS) {
      for (const r of ROLES) {
        if (t === req.team && r === req.role) continue;
        if (pwds[t]?.[r] === trimmed) {
          return res.status(400).json({ error: "invalid" });
        }
      }
    }
    pwds[req.team][req.role] = trimmed;
    writePasswords(pwds);
    logAccess(req, "PASSWORD_CHANGE");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "invalid" });
  }
});

// --- Categories ---
app.get("/api/categories", requirePassword, (req, res) => {
  try {
    res.json(getCatsForTeam(req.team));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/categories", requirePassword, requireAdmin, (req, res) => {
  try {
    const { label } = req.body || {};
    if (!label || !String(label).trim()) {
      return res.status(400).json({ error: "label required" });
    }
    const trimmed = String(label).trim();
    const cats = getCatsForTeam(req.team);
    if (cats.some((c) => c.label === trimmed)) {
      return res.status(409).json({ error: "같은 이름의 메뉴가 이미 있습니다." });
    }
    const key = `cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const newCat = { key, label: trimmed };
    cats.push(newCat);
    const all = readAllCats();
    all[req.team] = cats;
    writeAllCats(all);
    logAccess(req, "CATEGORY_ADD", trimmed);
    res.json(newCat);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/api/categories/:key", requirePassword, requireAdmin, (req, res) => {
  try {
    const { label } = req.body || {};
    if (!label || !String(label).trim()) {
      return res.status(400).json({ error: "label required" });
    }
    const trimmed = String(label).trim();
    const cats = getCatsForTeam(req.team);
    if (cats.some((c) => c.key !== req.params.key && c.label === trimmed)) {
      return res.status(409).json({ error: "같은 이름의 메뉴가 이미 있습니다." });
    }
    const idx = cats.findIndex((c) => c.key === req.params.key);
    if (idx === -1) return res.status(404).json({ error: "not found" });
    const oldLabel = cats[idx].label;
    cats[idx] = { ...cats[idx], label: trimmed };
    const all = readAllCats();
    all[req.team] = cats;
    writeAllCats(all);
    logAccess(req, "CATEGORY_RENAME", `${oldLabel} → ${trimmed}`);
    res.json(cats[idx]);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/categories/:key", requirePassword, requireAdmin, async (req, res) => {
  try {
    let deletedLabel = "";
    await serialize(async () => {
      const cats = getCatsForTeam(req.team);
      const target = cats.find((c) => c.key === req.params.key);
      deletedLabel = target?.label || req.params.key;
      const next = cats.filter((c) => c.key !== req.params.key);
      const all = readAllCats();
      all[req.team] = next;
      writeAllCats(all);

      const list = readAll();
      const targets = list.filter(
        (p) => p.category === req.params.key && p.team === req.team
      );
      const remaining = list.filter(
        (p) => !(p.category === req.params.key && p.team === req.team)
      );
      writeAll(remaining);

      for (const t of targets) {
        if (t.sourceType !== "file") continue;
        const stillReferenced = remaining.some(
          (p) => p.sourceType === "file" && p.src === t.src
        );
        if (!stillReferenced) {
          const abs = path.join(__dirname, t.src);
          if (abs.startsWith(UPLOAD_DIR) && fs.existsSync(abs)) {
            try { fs.unlinkSync(abs); } catch {}
          }
        }
      }
    });
    logAccess(req, "CATEGORY_DELETE", deletedLabel);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- Presentations ---
app.get("/api/presentations", requirePassword, (req, res) => {
  try {
    const list = readAll()
      .filter((p) => p.team === req.team)
      .map((p) => publicizeFileSrc(req, p));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/files/:id", (req, res) => {
  try {
    const pwd = req.header("x-app-password") || req.query.pwd;
    const auth = teamForPassword(pwd);
    if (!auth) return res.status(401).send("unauthorized");
    const item = readAll().find(
      (p) => p.id === req.params.id && p.sourceType === "file" && p.team === auth.team,
    );
    if (!item) return res.status(404).send("not found");
    const abs = path.join(__dirname, item.src);
    if (!abs.startsWith(UPLOAD_DIR)) return res.status(400).send("bad path");
    if (!fs.existsSync(abs)) return res.status(404).send("missing file");

    req.team = auth.team;
    req.role = auth.role;
    logAccess(req, "FILE_VIEW", item.name);

    const stat = fs.statSync(abs);
    const fileSize = stat.size;
    const range = req.headers.range;

    const contentType = item.mime || "application/octet-stream";
    const dispositionHeader = `inline; filename*=UTF-8''${encodeURIComponent(item.fileName || item.name)}`;

    if (range) {
      // ── Range 요청 처리 (동영상/오디오 탐색(seek) 지원용) ──
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= fileSize) {
        res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
        return res.end();
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
        "Content-Disposition": dispositionHeader,
      });
      fs.createReadStream(abs, { start, end }).pipe(res);
    } else {
      // ── 일반 요청 (Range 미지정) ──
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Content-Disposition": dispositionHeader,
      });
      fs.createReadStream(abs).pipe(res);
    }
  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const id = crypto.randomUUID();
      const ext = path.extname(file.originalname) || "";
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

app.post("/api/presentations", requirePassword, requireAdmin, upload.single("file"), async (req, res) => {
  try {
    const { name, category, sourceType, url, openMode, allowDownload } = req.body || {};
    if (!name || !category || !sourceType) {
      return res.status(400).json({ error: "missing fields" });
    }
    let entry;
    if (sourceType === "file") {
      if (!req.file) return res.status(400).json({ error: "file required" });
      const stored = req.file.filename;
      const id = path.basename(stored, path.extname(stored));
      entry = {
        id, name: String(name).trim(), category: String(category),
        sourceType: "file", src: path.posix.join("uploads", stored),
        mime: req.file.mimetype || "",
        fileName: Buffer.from(req.file.originalname, "latin1").toString("utf8") || "",
        createdAt: Date.now(), team: req.team,
        openMode: openMode === "new_tab" ? "new_tab" : "inline",
        allowDownload: allowDownload !== "false",
      };
    } else if (sourceType === "url") {
      if (!url) return res.status(400).json({ error: "url required" });
      entry = {
        id: crypto.randomUUID(), name: String(name).trim(),
        category: String(category), sourceType: "url",
        src: String(url).trim(), mime: "", fileName: "",
        createdAt: Date.now(), team: req.team,
        openMode: openMode === "new_tab" ? "new_tab" : "inline",
        allowDownload: allowDownload !== "false",
      };
    } else {
      return res.status(400).json({ error: "bad sourceType" });
    }
    await serialize(async () => {
      const list = readAll();
      list.push(entry);
      writeAll(list);
    });
    logAccess(req, "FILE_UPLOAD", entry.name);
    res.json(publicizeFileSrc(req, entry));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/presentations/:id", requirePassword, requireAdmin, async (req, res) => {
  try {
    let deletedName = "";
    await serialize(async () => {
      const list = readAll();
      const target = list.find((p) => p.id === req.params.id && p.team === req.team);
      if (!target) return;
      deletedName = target.name;
      const next = list.filter((p) => p.id !== req.params.id);
      writeAll(next);
      if (target.sourceType === "file") {
        const stillReferenced = next.some((p) => p.sourceType === "file" && p.src === target.src);
        if (!stillReferenced) {
          const abs = path.join(__dirname, target.src);
          if (abs.startsWith(UPLOAD_DIR) && fs.existsSync(abs)) {
            try { fs.unlinkSync(abs); } catch {}
          }
        }
      }
    });
    logAccess(req, "FILE_DELETE", deletedName);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/api/presentations/:id", requirePassword, requireAdmin, async (req, res) => {
  try {
    const { name, openMode, allowDownload } = req.body || {};
    if (!name && !openMode && allowDownload === undefined) {
      return res.status(400).json({ error: "name or openMode required" });
    }
    let updated = null;
    let oldName = "";
    await serialize(async () => {
      const list = readAll();
      const idx = list.findIndex((p) => p.id === req.params.id && p.team === req.team);
      if (idx === -1) return;
      oldName = list[idx].name;
      if (name && String(name).trim()) {
        list[idx] = { ...list[idx], name: String(name).trim() };
      }
      if (openMode === "inline" || openMode === "new_tab") {
        list[idx] = { ...list[idx], openMode };
      }
      if (allowDownload !== undefined) {
        list[idx] = { ...list[idx], allowDownload: allowDownload !== "false" && allowDownload !== false };
      }
      updated = list[idx];
      writeAll(list);
    });
    if (!updated) return res.status(404).json({ error: "not found" });
    if (name && name !== oldName) {
      logAccess(req, "FILE_RENAME", `${oldName} → ${updated.name}`);
    }
    if (openMode) {
      logAccess(req, "FILE_OPENMODE_CHANGE", `${updated.name} → ${openMode}`);
    }
    if (allowDownload !== undefined) {
      logAccess(req, "FILE_ALLOWDOWNLOAD_CHANGE", `${updated.name} → ${allowDownload}`);
    }
    res.json(publicizeFileSrc(req, updated));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// 카테고리 순서 변경
app.put("/api/categories/reorder", requirePassword, requireAdmin, (req, res) => {
  try {
    const { keys } = req.body || {};
    if (!Array.isArray(keys)) return res.status(400).json({ error: "keys required" });
    const cats = getCatsForTeam(req.team);
    const reordered = keys
      .map((k) => cats.find((c) => c.key === k))
      .filter(Boolean);
    const all = readAllCats();
    all[req.team] = reordered;
    writeAllCats(all);
    logAccess(req, "CATEGORY_REORDER");
    res.json(reordered);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// 프레젠테이션 순서 변경
app.put("/api/presentations/reorder", requirePassword, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids required" });
    await serialize(async () => {
      const list = readAll();
      const teamItems = list.filter((p) => p.team === req.team);
      const otherItems = list.filter((p) => p.team !== req.team);
      const reordered = ids
        .map((id) => teamItems.find((p) => p.id === id))
        .filter(Boolean);
      const unchanged = teamItems.filter((p) => !ids.includes(p.id));
      writeAll([...otherItems, ...reordered, ...unchanged]);
    });
    logAccess(req, "FILE_REORDER");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});


// ══════════════════════════════════════════════════════════════
// 게시판 API
// ══════════════════════════════════════════════════════════════

const BOARDS_PATH = path.join(DATA_DIR, "boards.json");
const POST_ATTACH_DIR = path.join(UPLOAD_DIR, "board_attachments");
fs.mkdirSync(POST_ATTACH_DIR, { recursive: true });

function readBoards() {
  if (!fs.existsSync(BOARDS_PATH)) {
    fs.writeFileSync(BOARDS_PATH, JSON.stringify([]), "utf8");
  }
  try { return JSON.parse(fs.readFileSync(BOARDS_PATH, "utf8")); }
  catch { return []; }
}
function writeBoards(boards) {
  fs.writeFileSync(BOARDS_PATH, JSON.stringify(boards, null, 2), "utf8");
}

const POST_HEADERS = ["id","boardId","title","content","author","team","createdAt","updatedAt","views","thumbnail","url","sourceName","attachments","isAutoCollected","matchedKeyword","g2bRefNo","g2bMatchType"];

function postsPath(boardId) {
  return path.join(DATA_DIR, `posts_${boardId}.csv`);
}
function readPosts(boardId) {
  const p = postsPath(boardId);
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, csvStringify([POST_HEADERS]), "utf8");
    return [];
  }
  const rows = csvParse(fs.readFileSync(p, "utf8"));
  if (rows.length === 0) return [];
  const [, ...data] = rows;
  return data.map(r => {
    const obj = {};
    POST_HEADERS.forEach((h, i) => { obj[h] = r[i] ?? ""; });
    obj.views = parseInt(obj.views) || 0;
    return obj;
  });
}
function writePosts(boardId, posts) {
  const out = [POST_HEADERS, ...posts.map(p => POST_HEADERS.map(h => {
    const v = p[h];
    return v === undefined || v === null ? "" : String(v);
  }))];
  fs.writeFileSync(postsPath(boardId), csvStringify(out), "utf8");
}

// ── 게시판 목록/CRUD ────────────────────────────────────────
app.get("/api/boards", requirePassword, (req, res) => {
  const boards = readBoards();
  const filtered = boards.filter(b => b.team === "both" || b.team === req.team);
  res.json(filtered);
});

app.post("/api/boards", requirePassword, requireAdmin, (req, res) => {
  try {
    const { name, type, allowWrite, team, secret } = req.body || {};
    if (!name || !type) return res.status(400).json({ error: "name and type required" });
    const boards = readBoards();
    const id = crypto.randomUUID();
    const newBoard = {
      id, name: String(name).trim(),
      type: type === "card" ? "card" : "list",
      allowWrite: allowWrite === "all" ? "all" : "admin",
      team: team === "both" ? "both" : req.team,
      secret: secret === true,
      createdAt: new Date().toISOString().split("T")[0],
      order: boards.length,
    };
    boards.push(newBoard);
    writeBoards(boards);
    fs.writeFileSync(postsPath(id), csvStringify([POST_HEADERS]), "utf8");
    logAccess(req, "BOARD_CREATE", newBoard.name);
    res.json(newBoard);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/api/boards/:boardId", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId } = req.params;
    const { name, allowWrite } = req.body || {};
    const boards = readBoards();
    const idx = boards.findIndex(b => b.id === boardId);
    if (idx === -1) return res.status(404).json({ error: "not found" });
    if (name) boards[idx].name = String(name).trim();
    if (allowWrite) boards[idx].allowWrite = allowWrite === "all" ? "all" : "admin";
    writeBoards(boards);
    logAccess(req, "BOARD_UPDATE", boards[idx].name);
    res.json(boards[idx]);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/boards/:boardId", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId } = req.params;
    const boards = readBoards();
    const idx = boards.findIndex(b => b.id === boardId);
    if (idx === -1) return res.status(404).json({ error: "not found" });
    const name = boards[idx].name;
    boards.splice(idx, 1);
    writeBoards(boards);
    const p = postsPath(boardId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    // 첨부파일 폴더 삭제
    const attachDir = path.join(POST_ATTACH_DIR, boardId);
    if (fs.existsSync(attachDir)) fs.rmSync(attachDir, { recursive: true, force: true });
    // 이 게시판에 연결된 자동수집 규칙(일반 크롤링 + 나라장터)도 함께 정리한다.
    // 그렇지 않으면 스케줄된 cron 작업이 삭제된 게시판을 향한 채로 계속 남아
    // "유령 규칙"이 되어 매일 정해진 시각에 불필요하게 실행된다.
    deleteCrawlRulesForBoard(boardId);
    deleteG2bRulesForBoard(boardId);
    logAccess(req, "BOARD_DELETE", name);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.put("/api/boards/reorder", requirePassword, requireAdmin, (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids)) return res.status(400).json({ error: "ids required" });
    const boards = readBoards();
    const reordered = ids.map((id, i) => {
      const b = boards.find(b => b.id === id);
      if (b) b.order = i;
      return b;
    }).filter(Boolean);
    const untouched = boards.filter(b => !ids.includes(b.id));
    writeBoards([...reordered, ...untouched]);
    logAccess(req, "BOARD_REORDER");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── 게시글 목록/상세 ────────────────────────────────────────
app.get("/api/boards/:boardId/posts", requirePassword, (req, res) => {
  try {
    const { boardId } = req.params;
    const boards = readBoards();
    const board = boards.find(b => b.id === boardId);
    if (!board) return res.status(404).json({ error: "board not found" });
    const posts = readPosts(boardId);
    const filtered = posts.filter(p => p.team === req.team || board.team === "both");
    filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/boards/:boardId/posts/:postId", requirePassword, (req, res) => {
  try {
    const { boardId, postId } = req.params;
    const posts = readPosts(boardId);
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return res.status(404).json({ error: "not found" });
    posts[idx].views = (parseInt(posts[idx].views) || 0) + 1;
    writePosts(boardId, posts);
    logAccess(req, "POST_VIEW", posts[idx].title);
    res.json(posts[idx]);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── 게시글 첨부파일 업로드 설정 (최대 5개, 파일당 200MB) ────
// 5개인 이유: 나라장터 사전규격 자동수집이 공고당 첨부파일을 최대 5개(specDocFileUrl1~5)
// 저장하므로, 자동수집 게시글에 첨부파일을 그대로 등록하려면 최소 5개는 되어야 한다.
// (나라장터 자동수집이 다운로드한 첨부파일을 게시글에 등록할 때도 이 값을 그대로 재사용한다.)
const BOARD_ATTACH_MAX_FILES = 5;
const boardAttachUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const boardId = req.params.boardId;
      const dir = path.join(POST_ATTACH_DIR, boardId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const id = crypto.randomUUID();
      const ext = path.extname(file.originalname) || "";
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: BOARD_ATTACH_MAX_FILES },
});

// ── 게시글 작성 (첨부파일 최대 5개) ───────────────────────
app.post("/api/boards/:boardId/posts", requirePassword, boardAttachUpload.array("files", BOARD_ATTACH_MAX_FILES), (req, res) => {
  try {
    const { boardId } = req.params;
    const boards = readBoards();
    const board = boards.find(b => b.id === boardId);
    if (!board) return res.status(404).json({ error: "board not found" });
    if (board.allowWrite === "admin" && req.role !== "admin") {
      return res.status(403).json({ error: "forbidden" });
    }
    const { title, content, thumbnail, url, sourceName } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });

    // 첨부파일 메타데이터 구성: name|storedFilename|size 를 ; 로 구분
    const attachments = (req.files || []).map(f => {
      const origNameEnc = encodeURIComponent(f.originalname);
      return `${origNameEnc}|${f.filename}|${f.size}`;
    }).join(";");

    const posts = readPosts(boardId);
    const newPost = {
      id: crypto.randomUUID(),
      boardId,
      title: String(title).trim(),
      content: String(content || "").trim(),
      author: req.team + "/" + req.role,
      team: req.team,
      createdAt: new Date().toISOString().split("T")[0],
      updatedAt: new Date().toISOString().split("T")[0],
      views: 0,
      thumbnail: thumbnail || "",
      url: url || "",
      sourceName: sourceName || "",
      attachments,
    };
    posts.unshift(newPost);
    writePosts(boardId, posts);
    logAccess(req, "POST_CREATE", newPost.title);
    res.json(newPost);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── 게시글 수정 (첨부파일 추가만 가능, 기존 것은 유지) ──────
app.patch("/api/boards/:boardId/posts/:postId", requirePassword, requireAdmin, boardAttachUpload.array("files", BOARD_ATTACH_MAX_FILES), (req, res) => {
  try {
    const { boardId, postId } = req.params;
    const { title, content, thumbnail, url, sourceName, keepAttachments } = req.body || {};
    const posts = readPosts(boardId);
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return res.status(404).json({ error: "not found" });

    if (title) posts[idx].title = String(title).trim();
    if (content !== undefined) posts[idx].content = String(content).trim();
    if (thumbnail !== undefined) posts[idx].thumbnail = thumbnail;
    if (url !== undefined) posts[idx].url = url;
    if (sourceName !== undefined) posts[idx].sourceName = sourceName;

    // keepAttachments: 프론트에서 유지할 기존 첨부파일 메타데이터 문자열(;구분) 전달
    let attachList = keepAttachments !== undefined ? String(keepAttachments) : posts[idx].attachments;
    const existing = attachList ? attachList.split(";").filter(Boolean) : [];

    const newOnes = (req.files || []).map(f => {
      const origNameEnc = encodeURIComponent(f.originalname);
      return `${origNameEnc}|${f.filename}|${f.size}`;
    });

    const combined = [...existing, ...newOnes].slice(0, BOARD_ATTACH_MAX_FILES);
    posts[idx].attachments = combined.join(";");
    posts[idx].updatedAt = new Date().toISOString().split("T")[0];

    writePosts(boardId, posts);
    logAccess(req, "POST_UPDATE", posts[idx].title);
    res.json(posts[idx]);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/boards/:boardId/posts/:postId", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId, postId } = req.params;
    const posts = readPosts(boardId);
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return res.status(404).json({ error: "not found" });
    const title = posts[idx].title;

    // 첨부파일 실제 삭제
    const attachments = (posts[idx].attachments || "").split(";").filter(Boolean);
    for (const a of attachments) {
      const [, stored] = a.split("|");
      if (stored) {
        const filePath = path.join(POST_ATTACH_DIR, boardId, stored);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }

    posts.splice(idx, 1);
    writePosts(boardId, posts);
    logAccess(req, "POST_DELETE", title);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── 첨부파일 개별 삭제 (수정 화면에서 X 버튼용) ─────────────
app.delete("/api/boards/:boardId/posts/:postId/attachments/:storedName", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId, postId, storedName } = req.params;
    const posts = readPosts(boardId);
    const idx = posts.findIndex(p => p.id === postId);
    if (idx === -1) return res.status(404).json({ error: "not found" });

    const attachments = (posts[idx].attachments || "").split(";").filter(Boolean);
    const remaining = attachments.filter(a => {
      const [, stored] = a.split("|");
      return stored !== storedName;
    });
    posts[idx].attachments = remaining.join(";");
    writePosts(boardId, posts);

    const filePath = path.join(POST_ATTACH_DIR, boardId, storedName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── 첨부파일 다운로드 ────────────────────────────────────────
app.get("/api/boards/:boardId/attachments/:storedName", requirePassword, (req, res) => {
  try {
    const { boardId, storedName } = req.params;
    const { name } = req.query; // 원본 파일명 (표시용, 인코딩됨)
    const filePath = path.join(POST_ATTACH_DIR, boardId, storedName);
    if (!filePath.startsWith(POST_ATTACH_DIR) || !fs.existsSync(filePath)) {
      return res.status(404).send("not found");
    }
    const displayName = name ? decodeURIComponent(String(name)) : storedName;
    res.download(filePath, displayName);
  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

// ── 첨부파일 미리보기 (브라우저 내장 뷰어로 새 탭에서 바로 열기) ──────────
// PDF는 원본을, hwp/hwpx는 hwp-worker(LibreOffice)로 변환한 결과를 보여준다.
// 둘 다 "크롬 PDF 뷰어는 File 이름보다 PDF 안에 박힌 /Title 메타데이터를 우선
// 표시한다"는 문제를 똑같이 겪는다 — G2B 원본 PDF도, LibreOffice가 변환한 PDF도
// 원본 문서 속성에 있던 깨진 제목을 그대로 갖고 있는 경우가 있어서, 둘 다
// fixPdfTitle로 제목을 명시적으로 덮어쓴 뒤 캐시해둔다. 첫 열람 시에만 처리하고
// 이후 열람은 캐시에서 즉시 응답한다(게시판 삭제 시 첨부파일 폴더 전체가 지워지므로
// 이 캐시도 함께 정리된다).
const PREVIEW_CACHE_DIRNAME = ".preview_cache";
const PREVIEW_PDF_EXTS = new Set(["pdf", "hwp", "hwpx"]);
const PREVIEW_INLINE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "txt"]);

// iPad(모바일) Safari에서 fetch()로 받아 Blob→File→URL.createObjectURL로 여는 예전 방식이
// "undefined is not a function (near '...value of readableStream...')" 오류로 깨지는 문제가
// 있었다(WebKit의 fetch body 스트리밍 관련 버그로 추정). 그래서 이 라우트는 브라우저가 URL을
// 새 탭에서 직접 열도록 바꿨고, 그러려면 커스텀 헤더(x-app-password)를 못 쓰므로 쿼리
// 파라미터 인증도 함께 허용한다 (/api/files/:id 라우트가 Range 요청 지원을 위해 이미 쓰고
// 있는 것과 동일한 패턴 — requirePassword 미들웨어를 쓰지 않고 이 라우트에서만 인라인 처리).
app.get("/api/boards/:boardId/attachments/:storedName/preview", async (req, res) => {
  try {
    const pwd = req.header("x-app-password") || req.query.pwd;
    const auth = teamForPassword(pwd);
    if (!auth) return res.status(401).json({ error: "unauthorized" });
    req.team = auth.team;
    req.role = auth.role;

    const { boardId, storedName } = req.params;
    const { name } = req.query; // 원본 파일명 (표시용, 인코딩됨) - 다운로드 라우트와 동일한 관례
    const filePath = path.join(POST_ATTACH_DIR, boardId, storedName);
    if (!filePath.startsWith(POST_ATTACH_DIR) || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: "파일을 찾을 수 없습니다." });
    }
    const ext = (storedName.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
    const displayName = name ? decodeURIComponent(String(name)) : storedName;
    // hwp/hwpx는 변환되어 실제로 PDF가 되므로, 브라우저에 보여줄 파일명도 확장자를
    // .pdf로 바꿔서 내려준다 (예전엔 프론트가 Blob을 File로 감싸며 처리하던 부분).
    const previewFileName = PREVIEW_PDF_EXTS.has(ext) && ext !== "pdf"
      ? `${displayName.replace(/\.[^./]+$/, "")}.pdf`
      : displayName;

    if (PREVIEW_PDF_EXTS.has(ext)) {
      const cacheDir = path.join(POST_ATTACH_DIR, boardId, PREVIEW_CACHE_DIRNAME);
      // pdf는 원본과 이름이 같아도(다른 디렉터리라) 캐시 파일명으로 그대로 써도 되고,
      // hwp/hwpx는 변환 결과물이라 확장자를 덧붙여 구분한다.
      const cachePath = path.join(cacheDir, ext === "pdf" ? storedName : `${storedName}.pdf`);
      if (!fs.existsSync(cachePath)) {
        let pdfBuf;
        if (ext === "pdf") {
          pdfBuf = fs.readFileSync(filePath);
        } else {
          const buf = fs.readFileSync(filePath);
          pdfBuf = await convertHwpToPdfViaWorker(buf, ext);
          if (!pdfBuf) {
            return res.status(502).json({ error: "미리보기를 생성할 수 없습니다. 다운로드해서 확인해주세요." });
          }
        }
        pdfBuf = await fixPdfTitle(pdfBuf, displayName.replace(/\.[^./]+$/, ""));
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cachePath, pdfBuf);
      }
      res.type("pdf");
      res.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(previewFileName)}`);
      return fs.createReadStream(cachePath).pipe(res);
    }

    if (!PREVIEW_INLINE_EXTS.has(ext)) {
      return res.status(415).json({ error: "미리보기를 지원하지 않는 파일 형식입니다. 다운로드해주세요." });
    }
    res.type(ext);
    res.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(previewFileName)}`);
    return fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});



// ══════════════════════════════════════════════════════════════
// 뉴스 자동 수집 (크롤링) 엔진
// ══════════════════════════════════════════════════════════════

const CRAWL_RULES_PATH = path.join(DATA_DIR, "crawl_rules.json");
const CRAWL_LOGS_PATH = path.join(DATA_DIR, "crawl_logs.json");

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || "";
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || "";
const NAVER_API_HUB_BASE = "https://naverapihub.apigw.ntruss.com";

function readCrawlRules() {
  if (!fs.existsSync(CRAWL_RULES_PATH)) {
    fs.writeFileSync(CRAWL_RULES_PATH, JSON.stringify([]), "utf8");
  }
  try { return JSON.parse(fs.readFileSync(CRAWL_RULES_PATH, "utf8")); }
  catch { return []; }
}
function writeCrawlRules(rules) {
  fs.writeFileSync(CRAWL_RULES_PATH, JSON.stringify(rules, null, 2), "utf8");
}

function readCrawlLogs() {
  if (!fs.existsSync(CRAWL_LOGS_PATH)) {
    fs.writeFileSync(CRAWL_LOGS_PATH, JSON.stringify([]), "utf8");
  }
  try { return JSON.parse(fs.readFileSync(CRAWL_LOGS_PATH, "utf8")); }
  catch { return []; }
}
function writeCrawlLogs(logs) {
  // 규칙당 최근 30개만 유지
  fs.writeFileSync(CRAWL_LOGS_PATH, JSON.stringify(logs, null, 2), "utf8");
}
function addCrawlLog(entry) {
  const logs = readCrawlLogs();
  logs.unshift(entry);
  writeCrawlLogs(logs.slice(0, 300)); // 전체 최대 300개 보관
}

// ── cron 표현식 생성 ──────────────────────────────────────────
function buildCronExpr(rule) {
  const { scheduleType, hour, minute, dayOfWeek, dayOfMonth } = rule;
  const m = minute ?? 0;
  const h = hour ?? 23;
  if (scheduleType === "daily") return `${m} ${h} * * *`;
  if (scheduleType === "weekly") return `${m} ${h} * * ${dayOfWeek ?? 6}`;
  if (scheduleType === "monthly") return `${m} ${h} ${dayOfMonth ?? 1} * *`;
  return `${m} ${h} * * 6`; // 기본값: 매주 토요일
}

// ── 네이버 뉴스 검색 (NAVER API HUB) ─────────────────────────
async function searchNaverNews(keyword, display = 20, start = 1) {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error("네이버 API 키가 설정되지 않았습니다 (.env 확인)");
  }
  const res = await axios.get(`${NAVER_API_HUB_BASE}/search/v1/news`, {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": NAVER_CLIENT_ID,
      "X-NCP-APIGW-API-KEY": NAVER_CLIENT_SECRET,
    },
    params: { query: keyword, display, start, sort: "date" },
    timeout: 10000,
  });
  return res.data.items || [];
}

// ── 키워드의 전체 검색 결과를 최대 1000개까지 모두 수집 (최신순) ──
async function searchNaverNewsAll(keyword) {
  const all = [];
  for (let start = 1; start <= 901; start += 100) {
    const display = Math.min(100, 1001 - start);
    const items = await searchNaverNews(keyword, display, start);
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < display) break; // 더 이상 결과 없음
    await new Promise(r => setTimeout(r, 200));
  }
  return all; // 최신순 정렬 상태
}

// ── 연도 세분화 검색: 키워드에 연도를 붙여 각각 최대 1000개씩 수집 ──
// (네이버 뉴스 검색 API는 키워드당 최대 1000개 제한이 있어,
//  "키워드 + 연도" 형태로 나눠 검색하면 사실상 검색 범위를 연도별로 우회 확장할 수 있음)
async function searchNaverNewsByYears(keyword, yearsBack = 10) {
  const currentYear = new Date().getFullYear();
  const allItems = [];
  const seenUrls = new Set();

  for (let i = 0; i < yearsBack; i++) {
    const year = currentYear - i;
    const yearKeyword = `${keyword} ${year}`;
    try {
      const items = await searchNaverNewsAll(yearKeyword);
      for (const item of items) {
        const url = item.originallink || item.link;
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          allItems.push(item);
        }
      }
    } catch (e) {
      console.error(`연도별 검색 실패 (${yearKeyword}):`, e?.message || e);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return allItems; // 연도 필터링을 거쳤으므로 정렬은 호출 측에서 처리
}

// pubDate 문자열 → Date 객체 변환 (네이버 형식: "Mon, 26 Aug 2026 10:00:00 +0900")
function parsePubDate(pubDate) {
  const d = new Date(pubDate);
  return isNaN(d.getTime()) ? null : d;
}

// ── 원문 페이지에서 썸네일(og:image) 추출 ────────────────────
async function fetchThumbnail(url) {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; M2SOFT-SFA-Bot/1.0)" },
      maxRedirects: 5,
    });
    const $ = cheerio.load(res.data);
    const ogImage = $('meta[property="og:image"]').attr("content");
    const ogSiteName = $('meta[property="og:site_name"]').attr("content");
    return { thumbnail: ogImage || "", siteName: ogSiteName || "" };
  } catch {
    return { thumbnail: "", siteName: "" };
  }
}

// HTML 태그(<b> 등) 제거 유틸
function stripHtml(str) {
  return String(str || "").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

const BOARD_POST_LIMIT = 2000; // 게시판 전체 게시글 수 상한

// ── 실제 크롤링 실행 (규칙 1개 처리) ─────────────────────────
async function runCrawlRule(rule) {
  const isFirstRun = !rule.lastRunAt;

  const boards = readBoards();
  const board = boards.find(b => b.id === rule.boardId);
  if (!board) {
    addCrawlLog({
      id: crypto.randomUUID(), ruleId: rule.id, ranAt: new Date().toISOString(),
      status: "failed", collected: 0, duplicates: 0, errorMsg: "게시판을 찾을 수 없음",
    });
    return;
  }

  const existingPosts = readPosts(rule.boardId);
  const existingUrls = new Set(existingPosts.map(p => p.url).filter(Boolean));

  // 게시판 내 "자동수집된" 게시글 중 가장 최신 날짜를 기준으로 삼음
  // (수동으로 등록한 최신 게시글 때문에 sinceDate가 잘못 앞당겨지는 것을 방지)
  let sinceDate = null;
  if (!isFirstRun) {
    const autoPosts = existingPosts.filter(p => p.isAutoCollected === "true");
    const dates = autoPosts.map(p => new Date(p.createdAt)).filter(d => !isNaN(d.getTime()));
    if (dates.length > 0) sinceDate = new Date(Math.max(...dates));
  }

  const remainingSlots = () => BOARD_POST_LIMIT - existingPosts.length;

  let collected = 0;
  let duplicates = 0;
  let errorMsg = null;
  let stoppedByLimit = false;
  let succeeded = false;

  try {
    for (const keyword of rule.keywords) {
      if (remainingSlots() <= 0) { stoppedByLimit = true; break; }

      let candidateItems = [];

      const matchesScope = (item) => {
        const titleText = stripHtml(item.title).toLowerCase();
        const descText = stripHtml(item.description).toLowerCase();
        const kw = keyword.toLowerCase();
        if (rule.searchScope === "title") {
          return titleText.includes(kw);
        }
        return titleText.includes(kw) || descText.includes(kw);
      };

      if (isFirstRun) {
        // 최초 백필: 최근 10개년치를 "키워드+연도" 형태로 각각 검색해 최대 1000개 제한을 연도별로 우회 확장
        // (네이버 뉴스 검색 API의 키워드당 1000개 제한 때문에 기사가 많은 키워드는
        //  단순 검색만으로는 오래된 기사에 도달할 수 없어 연도 세분화가 필요함)
        const allItems = await searchNaverNewsByYears(keyword, 10);
        const scoped = allItems.filter(matchesScope);
        // pubDate 기준 오래된 순 정렬 (연도별로 나눠 모았기 때문에 정렬이 필요)
        const withDate = scoped.map(item => ({ item, pub: parsePubDate(item.pubDate) }));
        withDate.sort((a, b) => {
          if (!a.pub && !b.pub) return 0;
          if (!a.pub) return 1;
          if (!b.pub) return -1;
          return a.pub - b.pub; // 오래된 순
        });
        const sorted = withDate.map(x => x.item);
        // maxInitialBackfill은 안전 상한선(기본 100)이지만, 실제로는 게시판 전체 상한(BOARD_POST_LIMIT)이
        // 최종 방어선 역할을 하므로 넉넉하게 설정하는 것을 권장 (설정 UI에서 상향 가능)
        candidateItems = sorted.slice(0, rule.maxInitialBackfill || 500);
      } else {
        // 정기/즉시 실행: sinceDate 이후 구간을 "키워드+연도" 형태로 연도별 세분화해서 검색
        // (단순히 "최신 1000개"만 가져오면, 기사가 많은 키워드의 경우 그 1000개가
        //  전부 최근 1~2년치로만 채워져서 sinceDate와 현재 사이의 중간 연도가 통째로
        //  누락되는 문제가 있었음 → 연도별로 나눠 검색해 이를 방지)
        const currentYear = new Date().getFullYear();
        const sinceYear = sinceDate ? sinceDate.getFullYear() : currentYear;
        const yearsToSearch = Math.max(1, currentYear - sinceYear + 1);

        const allItems = await searchNaverNewsByYears(keyword, yearsToSearch);
        const filtered = allItems.filter(item => {
          const pub = parsePubDate(item.pubDate);
          const dateOk = sinceDate ? (pub && pub > sinceDate) : true;
          return dateOk && matchesScope(item);
        });
        // pubDate 기준 오래된 순 정렬 (연도별로 나눠 모았기 때문에 정렬이 필요)
        const withDate2 = filtered.map(item => ({ item, pub: parsePubDate(item.pubDate) }));
        withDate2.sort((a, b) => {
          if (!a.pub && !b.pub) return 0;
          if (!a.pub) return 1;
          if (!b.pub) return -1;
          return a.pub - b.pub; // 오래된 순
        });
        const sortedIncremental = withDate2.map(x => x.item);
        // maxPerRun은 안전장치(1회 실행당 과도한 수집 방지)로만 사용, 넉넉한 값 권장
        candidateItems = sortedIncremental.slice(0, rule.maxPerRun || 100);
      }

      for (const item of candidateItems) {
        if (remainingSlots() <= 0) { stoppedByLimit = true; break; }
        if (isFirstRun && collected >= (rule.maxInitialBackfill || 500)) break;
        if (!isFirstRun && collected >= (rule.maxPerRun || 100)) break;

        const articleUrl = item.originallink || item.link;
        if (!articleUrl || existingUrls.has(articleUrl)) {
          if (existingUrls.has(articleUrl)) duplicates++;
          continue;
        }

        // 썸네일 + 매체명 보완 (cheerio) - 항상 수행
        const { thumbnail, siteName } = await fetchThumbnail(articleUrl);

        const pubDateObj = parsePubDate(item.pubDate);
        const createdAtStr = pubDateObj
          ? pubDateObj.toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0];

        const newPost = {
          id: crypto.randomUUID(),
          boardId: rule.boardId,
          title: stripHtml(item.title),
          content: stripHtml(item.description),
          author: "auto-crawler",
          team: board.team === "both" ? "both" : board.team,
          createdAt: createdAtStr,
          updatedAt: createdAtStr,
          views: 0,
          thumbnail,
          url: articleUrl,
          sourceName: siteName || "",
          attachments: "",
          isAutoCollected: "true",
          matchedKeyword: keyword,
        };

        existingPosts.push(newPost);
        existingUrls.add(articleUrl);
        collected++;

        // 과도한 요청 방지 딜레이
        await new Promise(r => setTimeout(r, 300));
      }

      if (stoppedByLimit) break;
    }

    // 최신순으로 정렬해서 저장 (프론트에서 다시 정렬하지만 안전하게)
    existingPosts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    writePosts(rule.boardId, existingPosts);

    addCrawlLog({
      id: crypto.randomUUID(), ruleId: rule.id, ranAt: new Date().toISOString(),
      status: "success", collected, duplicates,
      errorMsg: stoppedByLimit ? `게시판 게시글 상한(${BOARD_POST_LIMIT}개) 도달로 중단됨` : null,
    });
    succeeded = true;
  } catch (e) {
    errorMsg = e?.message || String(e);
    addCrawlLog({
      id: crypto.randomUUID(), ruleId: rule.id, ranAt: new Date().toISOString(),
      status: "failed", collected, duplicates, errorMsg,
    });
  }

  // lastRunAt 갱신 (성공했을 때만 — 실패 시 갱신하면 다음 실행이 실패 시점부터 조회하게 되어
  // 실패 구간에 올라온 게시물을 영영 놓치게 된다. 실패하면 다음 실행이 마지막 "성공" 시점부터
  // 다시 조회하도록 lastRunAt을 그대로 둔다.)
  if (succeeded) {
    const rules = readCrawlRules();
    const idx = rules.findIndex(r => r.id === rule.id);
    if (idx !== -1) {
      rules[idx].lastRunAt = new Date().toISOString();
      writeCrawlRules(rules);
    }
  }
}

// ── 스케줄러 등록 관리 ────────────────────────────────────────
const scheduledTasks = new Map(); // ruleId -> cron task

function scheduleRule(rule) {
  // 기존 등록된 작업 취소
  if (scheduledTasks.has(rule.id)) {
    scheduledTasks.get(rule.id).stop();
    scheduledTasks.delete(rule.id);
  }
  if (!rule.enabled) return;

  const cronExpr = buildCronExpr(rule);
  const task = cron.schedule(cronExpr, () => {
    runCrawlRule(rule).catch(e => console.error("크롤링 실행 오류:", e));
  }, { timezone: "Asia/Seoul" });

  scheduledTasks.set(rule.id, task);
}

function rescheduleAll() {
  const rules = readCrawlRules();
  rules.forEach(scheduleRule);
}

// 서버 시작 시 저장된 규칙들을 모두 스케줄 등록
rescheduleAll();

// 게시판 삭제 시 그 게시판에 연결된 크롤링 규칙(들)을 정리한다 (스케줄 정지 + 파일에서 제거).
function deleteCrawlRulesForBoard(boardId) {
  const rules = readCrawlRules();
  const remaining = rules.filter(r => {
    if (r.boardId !== boardId) return true;
    if (scheduledTasks.has(r.id)) {
      scheduledTasks.get(r.id).stop();
      scheduledTasks.delete(r.id);
    }
    return false;
  });
  if (remaining.length !== rules.length) writeCrawlRules(remaining);
}

// ── API: 크롤링 규칙 CRUD ────────────────────────────────────
app.get("/api/boards/:boardId/crawl-rule", requirePassword, requireAdmin, (req, res) => {
  const rules = readCrawlRules();
  const rule = rules.find(r => r.boardId === req.params.boardId);
  res.json(rule || null);
});

app.post("/api/boards/:boardId/crawl-rule", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId } = req.params;
    const { enabled, keywords, scheduleType, dayOfWeek, dayOfMonth, hour, minute, maxPerRun, maxInitialBackfill, searchScope } = req.body || {};

    if (!Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: "keywords required" });
    }

    const rules = readCrawlRules();
    const idx = rules.findIndex(r => r.boardId === boardId);

    const ruleData = {
      id: idx !== -1 ? rules[idx].id : crypto.randomUUID(),
      boardId,
      enabled: enabled !== false,
      keywords,
      scheduleType: scheduleType || "weekly",
      dayOfWeek: dayOfWeek ?? 6,
      dayOfMonth: dayOfMonth ?? 1,
      hour: hour ?? 23,
      minute: minute ?? 0,
      maxPerRun: maxPerRun || 5,
      maxInitialBackfill: maxInitialBackfill || 500,
      searchScope: searchScope === "title" ? "title" : "title_content",
      lastRunAt: idx !== -1 ? rules[idx].lastRunAt : null,
      createdAt: idx !== -1 ? rules[idx].createdAt : new Date().toISOString(),
    };

    if (idx !== -1) rules[idx] = ruleData;
    else rules.push(ruleData);

    writeCrawlRules(rules);
    scheduleRule(ruleData);

    logAccess(req, "CRAWL_RULE_SAVE", boardId);
    res.json(ruleData);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/boards/:boardId/crawl-rule", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId } = req.params;
    const rules = readCrawlRules();
    const idx = rules.findIndex(r => r.boardId === boardId);
    if (idx === -1) return res.status(404).json({ error: "not found" });

    const ruleId = rules[idx].id;
    if (scheduledTasks.has(ruleId)) {
      scheduledTasks.get(ruleId).stop();
      scheduledTasks.delete(ruleId);
    }
    rules.splice(idx, 1);
    writeCrawlRules(rules);

    logAccess(req, "CRAWL_RULE_DELETE", boardId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── API: 즉시 실행 ────────────────────────────────────────────
app.post("/api/boards/:boardId/crawl-rule/run-now", requirePassword, requireAdmin, async (req, res) => {
  try {
    const { boardId } = req.params;
    const rules = readCrawlRules();
    const rule = rules.find(r => r.boardId === boardId);
    if (!rule) return res.status(404).json({ error: "규칙이 없습니다" });

    // 비동기로 실행하고 즉시 응답 (오래 걸릴 수 있으므로)
    runCrawlRule(rule).catch(e => console.error("즉시 실행 오류:", e));
    logAccess(req, "CRAWL_RUN_NOW", boardId);
    res.json({ ok: true, message: "크롤링이 시작되었습니다" });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── API: 실행 이력 조회 ───────────────────────────────────────
app.get("/api/boards/:boardId/crawl-logs", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId } = req.params;
    const rules = readCrawlRules();
    const rule = rules.find(r => r.boardId === boardId);
    if (!rule) return res.json([]);

    const logs = readCrawlLogs().filter(l => l.ruleId === rule.id);
    res.json(logs.slice(0, 20));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});



// ══════════════════════════════════════════════════════════════
// 나라장터 사전규격 자동 수집 (크롤링) 엔진
// ══════════════════════════════════════════════════════════════

const G2B_RULES_PATH = path.join(DATA_DIR, "g2b_crawl_rules.json");
const G2B_LOGS_PATH = path.join(DATA_DIR, "g2b_crawl_logs.json");

const G2B_API_KEY_RAW = process.env.G2B_API_KEY || "";
const G2B_API_KEY = G2B_API_KEY_RAW ? decodeURIComponent(G2B_API_KEY_RAW) : "";
const G2B_PRESPEC_BASE = "https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService";

function readG2bRules() {
  if (!fs.existsSync(G2B_RULES_PATH)) {
    fs.writeFileSync(G2B_RULES_PATH, JSON.stringify([]), "utf8");
  }
  try { return JSON.parse(fs.readFileSync(G2B_RULES_PATH, "utf8")); }
  catch { return []; }
}
function writeG2bRules(rules) {
  fs.writeFileSync(G2B_RULES_PATH, JSON.stringify(rules, null, 2), "utf8");
}
function readG2bLogs() {
  if (!fs.existsSync(G2B_LOGS_PATH)) {
    fs.writeFileSync(G2B_LOGS_PATH, JSON.stringify([]), "utf8");
  }
  try { return JSON.parse(fs.readFileSync(G2B_LOGS_PATH, "utf8")); }
  catch { return []; }
}
function writeG2bLogs(logs) {
  fs.writeFileSync(G2B_LOGS_PATH, JSON.stringify(logs, null, 2), "utf8");
}
function addG2bLog(entry) {
  const logs = readG2bLogs();
  logs.unshift(entry);
  writeG2bLogs(logs.slice(0, 300));
}

function g2bFormatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

// ── G2B(data.go.kr) API 호출 직렬화 + 429 재시도(지수 백오프) ──────────
// data.go.kr 계열 API는 인증키(serviceKey) 단위로 초당/일일 트래픽 제한이 있다.
// 이 서버는 규칙이 여러 개(보드마다 1개)이고 전부 동일한 시각(02:00)에 스케줄되어
// 있어, cron이 발동하면 여러 규칙의 runG2bCrawlRule()이 사실상 동시에 실행되며
// 각자 페이징 호출을 쏟아낸다 — "지금 즉시 실행"과 겹쳐도 마찬가지다.
// 이를 하나의 큐로 직렬화해 항상 한 번에 하나의 요청만 나가도록 하고, 429가
// 오면 즉시 실패시키지 않고 대기 후 재시도한다(LibreOffice 직렬화와 동일한 패턴).
let g2bApiQueue = Promise.resolve();
function runG2bApiSerialized(task) {
  const result = g2bApiQueue.then(task, task);
  g2bApiQueue = result.catch(() => {});
  return result;
}

// data.go.kr(공공데이터포털) 공통 오류 코드(returnAuthMsg 기준) 설명 — 활용지원센터에서
// 제공하는 오류코드 표를 그대로 옮겨, 실패 로그에 코드만 찍히는 대신 무엇이 문제인지
// 바로 알 수 있게 한다. reasonCode(숫자)는 여러 오류가 같은 값을 공유하므로(예: "20"이
// SERVICE_KEY_IS_NULL/PERMISSION_DENIED/SERVICE_ACCESS_DENIED_ERROR에 모두 쓰임) 이름
// 기준(returnAuthMsg)으로 매핑한다.
const G2B_ERROR_MESSAGES = {
  APPLICATION_ERROR: "GW 내부 처리 중 예기치 않은 오류가 발생했습니다. 잠시 후 다시 호출하고, 문제가 반복되면 활용지원센터로 문의해 주세요.",
  HTTP_ERROR: "허용되지 않은 HTTP 요청이거나 기관 API 응답 처리에 실패했습니다. 요청 방식과 호출 URL을 확인해 주세요.",
  SERVICETIMEOUT_ERROR: "기관 API 또는 GW 연계 서비스와의 연결에 실패했거나 응답 대기시간을 초과했습니다. 잠시 후 다시 호출해 주세요.",
  INVALID_REQUEST_PARAMETER_ERROR: "요청 파라미터의 값이나 형식이 올바르지 않습니다. API 명세에서 파라미터 이름, 형식 및 허용값을 확인해 주세요.",
  NO_OPENAPI_SERVICE_ERROR: "요청한 오픈API 서비스가 존재하지 않거나 폐기되었습니다. 호출 URL에 오타가 없는지 확인해 주세요.",
  SERVICE_KEY_IS_NULL: "요청에 API 인증키가 포함되지 않았습니다. 공공데이터포털에서 발급받은 인증키를 요청 파라미터에 포함해 주세요.",
  PERMISSION_DENIED: "GW 접근 권한 검사에서 요청이 거부되었습니다. 해당 API의 활용신청 및 접근 권한을 확인해 주세요.",
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR: "API 서비스의 일일 호출 허용량을 초과했습니다. 호출량이 초기화된 이후 다시 이용하거나 트래픽 증설을 신청해 주세요.",
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR: "짧은 시간에 많은 요청이 발생하여 초당 호출 허용량을 초과했습니다. 잠시 후 다시 호출해 주세요.",
  BLACKLIST_IP_ACCESS_ERROR: "차단된 IP에서 호출한 요청입니다. 호출 서버의 IP를 확인하고, 차단 해제가 필요한 경우 활용지원센터로 문의해 주세요.",
  SERVICE_ACCESS_DENIED_ERROR: "해당 API 서비스에 대한 이용 권한이 확인되지 않습니다. 활용신청 여부와 승인 또는 일시중지 상태를 확인해 주세요.",
  SERVICE_KEY_IS_NOT_REGISTERED_ERROR: "등록되지 않은 API 인증키입니다. 인증키가 정확한지와 해당 서비스의 활용신청이 정상적으로 완료되었는지 확인해 주세요.",
  DEADLINE_HAS_EXPIRED_ERROR: "API 인증키의 사용 기한이 만료되었습니다. 공공데이터포털에서 이용 기간을 확인하거나 갱신해 주세요.",
};

// data.go.kr(공공데이터포털) 공통 오류 코드 중, 재시도로는 절대 해결되지 않는 것들(설정
// 문제 — 인증키, 권한, URL 등). 이런 오류는 429처럼 잠깐 대기한다고 해결되지 않으므로
// 백오프 재시도 없이 바로 실패시켜, 사용자가 빨리 원인을 확인하고 조치할 수 있게 한다.
// 22 = LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR (일일 트래픽 한도 초과) — 자정(KST) 초기화 전까지는
// 몇 번을 다시 불러도 계속 같은 이유로 실패한다.
const G2B_NON_RETRYABLE_REASON_NAMES = new Set([
  "SERVICE_KEY_IS_NULL",
  "PERMISSION_DENIED",
  "SERVICE_ACCESS_DENIED_ERROR",
  "SERVICE_KEY_IS_NOT_REGISTERED_ERROR",
  "DEADLINE_HAS_EXPIRED_ERROR",
  "NO_OPENAPI_SERVICE_ERROR",
  "INVALID_REQUEST_PARAMETER_ERROR",
  "BLACKLIST_IP_ACCESS_ERROR",
  "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR",
]);
const G2B_NON_RETRYABLE_REASON_CODES = new Set(["22"]); // returnAuthMsg가 없는 응답을 위한 하위호환 폴백

async function g2bApiGet(url, params) {
  return runG2bApiSerialized(async () => {
    const maxRetries = 4;
    for (let attempt = 0; ; attempt++) {
      try {
        return await axios.get(url, { params, timeout: 15000 });
      } catch (e) {
        const status = e?.response?.status;
        const header = e?.response?.data?.OpenAPI_ServiceResponse?.cmmMsgHeader;
        const reasonCode = header?.returnReasonCode;
        const reasonName = header?.returnAuthMsg;
        const reasonDesc = (reasonName && G2B_ERROR_MESSAGES[reasonName]) || null;
        const bodySnippet = (() => {
          try { return JSON.stringify(e?.response?.data).slice(0, 500); } catch { return String(e?.response?.data).slice(0, 500); }
        })();
        logG2b(`API 호출 오류 (시도 ${attempt + 1}/${maxRetries + 1}) status=${status ?? "-"} reasonCode=${reasonCode ?? "-"} reasonName=${reasonName ?? "-"} message=${e?.message} params=${JSON.stringify({ ...params, serviceKey: "***" })} response=${bodySnippet}`);

        const isNonRetryable = (reasonName && G2B_NON_RETRYABLE_REASON_NAMES.has(reasonName)) ||
          (reasonCode && G2B_NON_RETRYABLE_REASON_CODES.has(reasonCode));
        if (isNonRetryable) {
          logG2b(`재시도 불가능한 오류(reasonCode=${reasonCode ?? "-"}, ${reasonName || header?.errMsg || "-"}) - 즉시 실패 처리: ${reasonDesc || "-"}`);
          const err = new Error(`나라장터 API 오류: ${reasonDesc || reasonName || "일일 서비스 요청제한 횟수 초과"} (${reasonName || "reasonCode=" + reasonCode})`);
          err.g2bReasonCode = reasonCode;
          err.g2bReasonName = reasonName;
          throw err;
        }

        if (status === 429 && attempt < maxRetries) {
          const waitMs = 3000 * Math.pow(2, attempt); // 3s, 6s, 12s, 24s
          logG2b(`429 응답 - ${waitMs}ms 대기 후 재시도`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        throw e;
      }
    }
  });
}

// ── 나라장터 사전규격 API 호출 (오퍼레이션별, 날짜범위 내 전체 페이징) ──
// 나라장터 사전규격정보서비스는 업무구분(용역/물품/외자/공사)마다 오퍼레이션이 분리되어
// 있다 — "검색조건에 의한 사전규격 용역 목록 조회"(getPublicPrcureThngInfoServcPPSSrch)는
// 일반용역/기술용역만, "…물품 목록 조회"(getPublicPrcureThngInfoThngPPSSrch)는 물품만
// 돌려준다. 일반용역/기술용역은 같은 용역 오퍼레이션 안에서 응답의 bsnsDivNm으로만
// 구분되므로(요청 파라미터로 구분 불가) 응답을 받은 후 rule.bizTypes 로 필터링한다.
async function fetchG2bPreSpec(operation, inqryBgnDt, inqryEndDt, swBizObjYn) {
  if (!G2B_API_KEY) {
    throw new Error("나라장터 API 키가 설정되지 않았습니다 (.env의 G2B_API_KEY 확인)");
  }
  const all = [];
  let pageNo = 1;
  const numOfRows = 100;
  while (true) {
    const res = await g2bApiGet(`${G2B_PRESPEC_BASE}/${operation}`, {
      serviceKey: G2B_API_KEY,
      pageNo,
      numOfRows,
      inqryDiv: 1,
      inqryBgnDt,
      inqryEndDt,
      type: "json",
      // swBizObjYn은 API 명세상 옵션 파라미터(0) — 지정하지 않으면 SW사업대상여부와
      // 무관하게 전체가 반환된다. "Y"/"N"으로 명시하면 나라장터 서버가 직접 걸러서
      // 응답해주므로, 클라이언트에서 다시 필터링할 필요 없이 조회량 자체가 줄어든다.
      ...(swBizObjYn ? { swBizObjYn } : {}),
    });
    const body = res.data?.response?.body;
    const items = body?.items || [];
    all.push(...items);
    const totalCount = Number(body?.totalCount || 0);
    if (items.length === 0 || all.length >= totalCount || pageNo > 50) break;
    pageNo++;
    await new Promise(r => setTimeout(r, 300));
  }
  return all;
}

// ── 날짜 범위를 15일 단위로 분할하여 조회 (API 조회 기간 제한 대응) ──
async function fetchG2bPreSpecRange(operation, startDate, endDate, swBizObjYn) {
  const chunks = [];
  let cursor = new Date(startDate);
  while (cursor <= endDate) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + 14);
    const actualEnd = chunkEnd > endDate ? endDate : chunkEnd;
    chunks.push([new Date(cursor), new Date(actualEnd)]);
    cursor = new Date(actualEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  const all = [];
  for (const [from, to] of chunks) {
    const bgnDt = g2bFormatDate(from) + "0000";
    const endDt = g2bFormatDate(to) + "2359";
    const items = await fetchG2bPreSpec(operation, bgnDt, endDt, swBizObjYn);
    all.push(...items);
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

// 업무구분(bizTypes)에 물품이 포함되어 있으면 물품 전용 오퍼레이션도 함께 조회해야 한다.
// 일반용역/기술용역은 둘 다 같은 용역 오퍼레이션에서 나오므로, 이 둘 중 하나라도 선택되어
// 있으면 용역 오퍼레이션 1번만 호출하면 된다.
const G2B_OP_SERVC = "getPublicPrcureThngInfoServcPPSSrch"; // 일반용역/기술용역
const G2B_OP_THNG = "getPublicPrcureThngInfoThngPPSSrch"; // 물품

async function fetchG2bPreSpecForRule(rule, startDate, endDate) {
  const bizTypes = rule.bizTypes && rule.bizTypes.length > 0 ? rule.bizTypes : ["일반용역", "기술용역"];
  const needsServc = bizTypes.includes("일반용역") || bizTypes.includes("기술용역");
  const needsThng = bizTypes.includes("물품");

  const operations = [];
  if (needsServc || !needsThng) operations.push(G2B_OP_SERVC); // 아무 것도 안 걸리면(예: 알 수 없는 값만 저장된 경우) 기존 기본값(용역)으로 폴백
  if (needsThng) operations.push(G2B_OP_THNG);

  // swBizObjYn: "Y"(SW사업 대상만)/"N"(SW사업 대상 아님만)/""(전체, 필터 없음) — 검색조건
  // 자체에 포함되므로 서버(나라장터) 쪽에서 걸러져서 온다.
  const swBizObjYn = rule.swBizObjYn === "Y" || rule.swBizObjYn === "N" ? rule.swBizObjYn : "";

  const all = [];
  for (const operation of operations) {
    const items = await fetchG2bPreSpecRange(operation, startDate, endDate, swBizObjYn);
    all.push(...items);
  }
  return all;
}

// ── 첨부파일(hwp/hwpx/pdf) 다운로드 후 텍스트 추출 (키워드 매칭용) ──────
// hwp: 2단계 폴백 전략
//   1차: @ohah/hwpjs (빠름) - Rust 코어가 손상되었거나 특이한 구조의 hwp 파일을
//        만나면 panic으로 프로세스가 죽을 수 있어, 별도의 자식 프로세스(hwp_worker.js)
//        에서 실행하여 크래시가 나도 메인 서버는 죽지 않도록 격리한다.
//   2차: LibreOffice(H2Orestart 확장) 변환 (느리지만 안정적) - 1차가 실패하거나
//        빈 텍스트를 반환한 경우에만 시도하여, hwpjs의 도형 파싱 버그 등을 우회한다.
// hwpx: hwpjs가 지원하지 않는 포맷(zip+XML 기반)이라 1차 없이 바로 LibreOffice(H2Orestart)로 변환한다.
// pdf: pdf-parse로 버퍼에서 바로 텍스트 레이어를 추출한다 (임시파일/LibreOffice 불필요).
//
// 예전엔 첨부파일 URL이 확장자를 노출하지 않는다는 이유로 모든 첨부파일을 무조건
// hwp로 간주해 hwp 전용 파이프라인에 강제로 밀어넣었는데, 실제로는 pdf·hwpx 등
// 다른 형식도 섞여 있어 이 파일들이 원인 불명의 추출 실패/타임아웃을 유발했다.
// 지금은 다운로드 응답을 실제로 검사(매직바이트 + Content-Disposition 파일명)해서
// 형식을 판별한 뒤 알맞은 경로로 보낸다.
const HWP_WORKER_PATH = path.join(__dirname, "hwp_worker.js");
const HWP_TMP_DIR = path.join(DATA_DIR, "hwp_tmp");
fs.mkdirSync(HWP_TMP_DIR, { recursive: true });

// 첨부파일 하나(hwpjs 1차 + LibreOffice 2차 폴백 전체 합산) 처리에 허용하는 최대 시간.
// 유난히 크거나 손상된 hwp 파일 하나가 몇십 분씩 물고 늘어지는 걸 막기 위한 안전장치 —
// 이 시간을 넘기면 그 파일은 "추출 실패"로 확정하고 다음 파일로 넘어간다.
const HWP_EXTRACT_HARD_TIMEOUT_MS = 10 * 60 * 1000; // 10분

// 이보다 큰 첨부파일은 추출을 아예 시도하지 않고 바로 "확인 필요"로 처리한다.
// (기존 5MB는 로컬 LibreOffice 방식 기준 — hwp 3.8MB·4.9MB 파일이 각각 8~9분씩 걸렸던
// 전례로 잡은 값. Docker 워커(hwp-worker)로 전환하면서 10MB로 상향 — 필요시 조정)
const HWP_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// ── 첨부파일 실제 형식 감지 (hwp/hwpx/pdf/기타) ──
// G2B 첨부파일 URL(...&fileType=BFDTL&fileSeq=N)은 파일명이나 확장자를 노출하지
// 않으므로, 다운로드 응답의 파일 시그니처(매직바이트)와 Content-Disposition
// 헤더의 파일명을 함께 확인해 실제 형식을 판별한다.
// 형식 판별과 함께, Content-Disposition에 담긴 원본 파일명도 함께 반환한다 — 원래는
// 확장자 판별에만 쓰고 버렸지만, 다운로드한 첨부파일을 게시글에 그대로 등록하려면
// (사용자가 나라장터에 직접 방문하지 않고도 다운로드할 수 있도록) 원본 파일명이 필요하다.
function detectAttachmentType(buf, headers) {
  let filename = null;
  let extFromName = null;
  try {
    const cd = headers?.["content-disposition"] || "";
    const star = cd.match(/filename\*\s*=\s*[^']*''([^;]+)/i);
    if (star) filename = decodeURIComponent(star[1]);
    else {
      const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (plain) {
        filename = plain[1];
        // 나라장터 등 일부 서버는 RFC 5987(filename*=UTF-8'') 표준 없이, filename="" 안에
        // 퍼센트 인코딩된 UTF-8 바이트를 그대로 넣어 보낸다(예: filename="%EC%A0%9C...pdf").
        // 이걸 그대로 두면 이후 저장 시 encodeURIComponent가 한 번 더 씌워져 이중 인코딩되고,
        // 화면에는 "%EC%A0%9C..." 같은 원문 그대로 노출된다 — 퍼센트 인코딩 패턴이 보이면
        // 미리 한 번 디코딩해 실제 파일명(예: "제안요청서.pdf")으로 정규화한다.
        if (/%[0-9A-Fa-f]{2}/.test(filename)) {
          try { filename = decodeURIComponent(filename); } catch { /* 디코딩 실패 시 원본 그대로 사용 */ }
        }
      }
    }
    if (filename) {
      const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
      if (m) extFromName = m[1];
    }
  } catch { /* 무시 */ }

  const isPdf = buf.length >= 5 && buf.slice(0, 5).toString("latin1") === "%PDF-";
  // OLE 복합 파일(Compound File Binary) 시그니처 - hwp(구버전), doc(97-2003), xls(97-2003)가
  // 전부 이 포맷을 공유해서 매직바이트만으로는 셋을 구분할 수 없다. 확장자 정보가 있으면
  // 그걸로 정확히 구분하고, 없을 때만 기존처럼 hwp로 추정한다(아래 우선순위 참고).
  const isOleCfb = buf.length >= 8 &&
    buf.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const isZip = buf.length >= 2 && buf.slice(0, 2).toString("latin1") === "PK";

  // 엑셀 계열(xls/xlsx/xlsm/xlsb)은 검사 대상에서 항상 제외한다 - xls는 OLE(위 hwp/doc과
  // 매직바이트 동일), xlsx/xlsm/xlsb는 zip 컨테이너(아래 docx/hwpx/zip과 매직바이트 동일)라
  // 매직바이트만으로는 구분이 안 되므로, 반드시 확장자로만 판별한다.
  const EXCEL_EXTS = new Set(["xls", "xlsx", "xlsm", "xlsb"]);

  // 확장자가 확인되면(대부분의 경우) 매직바이트보다 확장자를 우선 신뢰한다 - 위에서 설명한
  // 대로 hwp/doc/xls, 그리고 hwpx/docx/zip끼리는 매직바이트가 서로 같아서 확장자 없이는
  // 정확히 구분할 수 없기 때문. 확장자 정보가 없을 때만(드묾) 매직바이트로 추정한다.
  let type;
  if (extFromName && EXCEL_EXTS.has(extFromName)) type = "excel"; // 검사 제외
  else if (extFromName === "zip") type = "zip";
  else if (extFromName === "docx") type = "docx";
  else if (extFromName === "doc") type = "doc";
  else if (extFromName === "hwpx") type = "hwpx";
  else if (extFromName === "hwp") type = "hwp";
  else if (extFromName === "pdf") type = "pdf";
  else if (isPdf) type = "pdf";
  else if (isOleCfb) type = "hwp"; // 확장자 정보 없음 - 기존 동작대로 hwp로 추정
  else if (isZip) type = "hwpx"; // 확장자 정보 없음 - 기존 동작대로 hwpx로 추정
  else type = "other";

  return { type, filename };
}

// ── pdf 텍스트 추출 (pdf-parse) ── 텍스트 레이어가 있는 pdf만 추출 가능하며,
// 스캔 이미지로만 된 pdf는 빈 텍스트가 반환되어 "확인 필요"로 처리된다.
async function extractPdfText(buf) {
  try {
    const data = await pdfParse(buf);
    return data.text || "";
  } catch (e) {
    logG2b(`pdf 텍스트 추출 오류: ${e?.message || e}`);
    return "";
  }
}

// 타임아웃이 실제로 확정된 시점에만 호출한다. LibreOffice 변환은 sofficeQueue로
// 완전히 직렬화되어 있어 이 시점에 시스템에 남아있는 soffice.bin은 100% 지금 막
// 포기하기로 한 이 파일의 것뿐이므로, 다른 정상 진행 중인 변환을 실수로 죽일 위험 없이
// 안전하게 정리할 수 있다 (진행 중인 작업을 조용히 죽여 사업을 놓치는 일을 막기 위해,
// 이 타이밍 이외에는 절대 강제 종료하지 않는다).
async function killAllSofficeBin() {
  if (process.platform !== "win32") return;
  return new Promise((resolve) => {
    execFile("taskkill", ["/F", "/IM", "soffice.bin"], { timeout: 10000 }, () => resolve());
  });
}

// 이 앱은 -env:UserInstallation을 쓰지 않아 LibreOffice 기본 프로필(%APPDATA%\LibreOffice\4\user)을
// 그대로 공유한다. soffice.bin을 강제 종료하면 정상 종료 시 스스로 지우는 .lock 파일이 남을 수 있는데,
// 이 파일이 남아있으면 다음 실행 때 "이전에 비정상 종료됨, 복구하시겠습니까?" 라는 숨은 대화상자가
// headless 모드에서도 뜨면서 응답을 무한정 기다려 또 다른 타임아웃/실패를 유발할 수 있다.
// killAllSofficeBin() 직후에만(=직렬화로 안전이 보장된 그 타이밍에만) 호출해서 정리한다.
const LO_PROFILE_LOCK_PATH = process.env.APPDATA
  ? path.join(process.env.APPDATA, "LibreOffice", "4", "user", ".lock")
  : null;

function cleanupStaleSofficeLock() {
  if (!LO_PROFILE_LOCK_PATH) return;
  try {
    if (fs.existsSync(LO_PROFILE_LOCK_PATH)) {
      fs.unlinkSync(LO_PROFILE_LOCK_PATH);
      logG2b(`LibreOffice 프로필 잠금파일(.lock) 정리함: ${LO_PROFILE_LOCK_PATH}`);
    }
  } catch (e) {
    logG2b(`LibreOffice 프로필 잠금파일 정리 실패: ${e?.message || e}`);
  }
}

// ── 1차: hwpjs를 격리된 자식 프로세스에서 실행 ─────────────────
async function extractHwpTextViaHwpjs(tmpFilePath) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [HWP_WORKER_PATH, tmpFilePath],
      { timeout: 30000, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          console.error("hwp_worker(1차:hwpjs) 실행 오류:", error.message);
          // Rust panic 메시지(예: "thread '<unnamed>' panicked at ...")는 보통 stderr로
          // 나오는데 지금까진 콘솔에만 찍히고 파일 로그엔 안 남았다. 원인 추적을 위해
          // 다음 파일에서 같은 문제가 재발할 때 바로 확인할 수 있도록 g2b_debug.log에도 남긴다.
          logG2b(`hwp_worker(1차:hwpjs) 실행 오류: ${tmpFilePath} - ${error.message}${stderr ? ` | stderr: ${String(stderr).slice(0, 500)}` : ""}`);
          resolve("");
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout).trim().split(String.fromCharCode(10)).pop() || "{}");
          resolve(parsed.ok ? (parsed.text || "") : "");
        } catch {
          resolve("");
        }
      }
    );
  });
}

// ── soffice 실행 파일 경로 탐지 (OS별) ─────────────────────────
// Windows는 기본적으로 soffice가 PATH에 등록되어 있지 않은 경우가 많아
// 흔한 설치 경로를 순서대로 확인한다. 리눅스(Docker)는 PATH의 "soffice"로 충분하다.
function findSofficeCommand() {
  if (process.env.SOFFICE_PATH && fs.existsSync(process.env.SOFFICE_PATH)) {
    return process.env.SOFFICE_PATH;
  }
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  // 리눅스/맥 또는 PATH에 등록된 경우
  return "soffice";
}
const SOFFICE_CMD = findSofficeCommand();
// LibreOffice(특히 Windows)는 실행 파일의 디렉터리("program" 폴더)를 작업 디렉터리로
// 두고 실행해야 내부 라이브러리 경로를 정상적으로 찾는 경우가 있어, 절대경로일 때는
// 그 디렉터리를 cwd로 지정한다. (PATH의 "soffice"만 쓰는 리눅스/Docker는 해당 없음)
const SOFFICE_CWD = path.isAbsolute(SOFFICE_CMD) ? path.dirname(SOFFICE_CMD) : undefined;

// ── 2차: LibreOffice(H2Orestart)로 hwp → txt(UTF8) 변환 ────────
// LibreOffice는 동일 사용자 프로필을 여러 프로세스가 거의 동시에 사용하면
// (순차 실행이라도 이전 프로세스 종료 타이밍과 살짝만 겹쳐도) 프로필 잠금 충돌이
// 발생할 수 있다. -env:UserInstallation 으로 매번 새 프로필을 쓰는 방법은
// Windows 환경에서 오히려 오류를 유발하는 것이 확인되어, 대신 Node.js 쪽에서
// soffice 호출 자체를 완전히 하나씩 직렬화(mutex)하는 방식으로 충돌을 방지한다.
let sofficeQueue = Promise.resolve();
function runSofficeSerialized(task) {
  const result = sofficeQueue.then(task, task);
  // 이전 작업의 성공/실패와 무관하게 다음 작업이 이어지도록 catch로 큐를 이어감
  sofficeQueue = result.catch(() => {});
  return result;
}

// 결과 txt 파일이 "완전히 다 쓰여졌는지"를 파일 크기 안정화로 판별한다.
// (execFile의 콜백이 호출되어도 OS/자식 프로세스 쪽에서 파일 쓰기가 완전히
//  끝났다는 보장이 없는 경우가 있어, 일정 간격으로 크기를 확인해 두 번 연속
//  동일하면 "완료"로 간주하는 방식으로 안전하게 확인한다.)
// 결과 txt 파일이 실제로 완성될 때까지 기다린다.
// Windows의 soffice.exe는 런처일 뿐이라 실제 변환은 별도의 soffice.bin
// 프로세스가 백그라운드에서 수행하며, soffice.exe(및 execFile 콜백)는 그
// 작업이 끝나기 전에 먼저 반환될 수 있다. 따라서 콜백을 신뢰하지 않고
// 파일이 "생성됨 + 크기가 여러 번 연속 동일함"이 될 때까지 직접 폴링한다.
async function waitForFileStable(filePath, { intervalMs = 1000, maxWaitMs = 240000, requiredStableChecks = 3 } = {}) {
  const start = Date.now();
  let lastSize = -1;
  let stableCount = 0;
  while (Date.now() - start < maxWaitMs) {
    if (fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size;
      if (size > 0 && size === lastSize) {
        stableCount++;
        if (stableCount >= requiredStableChecks) return true;
      } else {
        stableCount = 0;
      }
      lastSize = size;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return fs.existsSync(filePath) && lastSize > 0;
}

// 현재 실행 중인 soffice.bin(실제 작업 프로세스) 개수를 확인한다 (Windows 전용).
// 이 개수가 0이 되어야 완전히 종료된 것으로 간주할 수 있다.
async function countRunningSofficeBin() {
  if (process.platform !== "win32") return 0;
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", "IMAGENAME eq soffice.bin"], { timeout: 10000 }, (err, stdout) => {
      if (err) { resolve(0); return; }
      const matches = String(stdout).match(/soffice\.bin/gi);
      resolve(matches ? matches.length : 0);
    });
  });
}

// soffice.bin 프로세스가 모두 종료될 때까지 대기 (강제 종료(kill)는 하지 않음).
async function waitForSofficeBinExit({ intervalMs = 1000, maxWaitMs = 30000 } = {}) {
  if (process.platform !== "win32") return;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const count = await countRunningSofficeBin();
    if (count === 0) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── hwp/hwpx 변환: Docker 워커로 위임 (HWP_WORKER_URLS 설정 시) ──────────
// HWP_WORKER_URLS 환경변수에 콤마로 구분된 워커 URL 목록을 넣으면(예:
// "http://localhost:4101,http://localhost:4102") LibreOffice 변환을 이
// 워커 컨테이너들에 위임한다. 설정하지 않으면(기본값) 지금까지처럼 이 서버가
// 직접 로컬 LibreOffice(soffice)를 실행한다 — 마이그레이션 기간 동안 두 경로를
// 동시에 유지하기 위한 feature-flag 방식이며, 워커 쪽이 실전에서 안정적임이
// 확인되면 이후 로컬 LibreOffice 관련 코드를 정리할 예정이다.
const HWP_WORKER_URLS = (process.env.HWP_WORKER_URLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
let hwpWorkerRoundRobinIdx = 0;

// 워커 각각에 대해 "이 서버가 보냈지만 아직 응답받지 못한 요청 수"(진행 중인 작업 수)를
// 추적한다. 각 워커 컨테이너는 내부적으로 요청을 한 번에 하나씩만 순서대로 처리하므로
// (worker/index.js의 직렬 큐), 순수 라운드로빈으로만 배정하면 이미 여러 건이 밀려 있는
// 워커에 또 배정되는 경우가 생기고, 그 요청은 앞선 작업들이 끝날 때까지 대기하게 된다.
// 실제로 이 대기 시간 때문에 개별 파일 변환은 60초 안에 끝났는데도(성공) 서버가 재는
// 전체 소요시간은 60초를 훌쩍 넘는 사례가 관측되었다(예: 같은 파일이 한가한 시간대엔
// 10초, 혼잡한 시간대엔 203초). 그래서 배정 시 "현재 가장 한가한(진행 중 작업이 적은)
// 워커"를 우선으로 고르도록 개선한다.
const hwpWorkerInFlight = new Array(HWP_WORKER_URLS.length).fill(0);

// 시도할 워커 순서를 정한다: 진행 중인 작업 수가 적은 워커부터 우선하되, 동률인
// 워커끼리는 라운드로빈으로 돌아가며 앞세워 부하를 고르게 분산시킨다.
function pickHwpWorkerOrder() {
  const startIdx = hwpWorkerRoundRobinIdx % HWP_WORKER_URLS.length;
  hwpWorkerRoundRobinIdx = (hwpWorkerRoundRobinIdx + 1) % HWP_WORKER_URLS.length;
  const order = HWP_WORKER_URLS.map((_, i) => (startIdx + i) % HWP_WORKER_URLS.length);
  order.sort((a, b) => hwpWorkerInFlight[a] - hwpWorkerInFlight[b]);
  return order;
}

// 워커 "호출 자체"가 실패한 경우(연결 불가, 응답 없음, 5xx 등)에만 다음 워커로
// 넘어가고, 그마저 모두 실패하면 null을 반환해 호출부가 기존 로컬 LibreOffice
// 경로로 폴백하도록 한다. 반면 워커가 정상적으로 응답했지만 변환 자체가
// 실패(success:false, 예: 타임아웃/빈 결과)한 경우는 "이 파일 자체가 원래 안 되는
// 파일"로 보고 그대로 실패를 반환한다 — 로컬 LibreOffice로 다시 시도해도 대개
// 동일하게 실패할 가능성이 높아, 이중으로 시간을 낭비하지 않기 위함이다.
async function extractHwpTextViaWorker(buf, ext) {
  if (HWP_WORKER_URLS.length === 0) return null;
  const order = pickHwpWorkerOrder();

  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    const workerUrl = HWP_WORKER_URLS[idx];
    hwpWorkerInFlight[idx]++;
    try {
      const res = await axios.post(`${workerUrl}/convert?ext=${ext}`, buf, {
        headers: { "Content-Type": "application/octet-stream" },
        timeout: 75000, // 워커 내부 soffice 타임아웃(60초)보다 여유를 둠
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300 && res.data) {
        if (res.data.success) {
          logG2b(`hwp-worker 변환 완료 (${workerUrl}): ${(res.data.text || "").length}자`);
          return res.data.text || "";
        }
        logG2b(`hwp-worker 변환 실패 응답 (${workerUrl}): ${res.data.reason || "unknown"}`);
        return ""; // 워커가 정상 응답 - 로컬 폴백 없이 그대로 실패 처리
      }
      logG2b(`hwp-worker 비정상 응답(status ${res.status}) - 다음 워커 시도: ${workerUrl}`);
    } catch (e) {
      // 클라이언트 타임아웃(75초 초과)은 "이 워커가 응답을 못 받았다"는 뜻이라기보다,
      // 파일 자체가 오래 걸리는 경우(말썽 파일)일 가능성이 높다 — 실제로 확인한 바, 이런
      // 파일은 어느 워커로 보내도 똑같이 오래 걸린다. 그런데도 예전 코드는 이 경우까지
      // "다음 워커 시도"로 처리해서, 말썽 파일 하나가 워커 10개를 전부 75초씩 물고 늘어져
      // 최대 750초(12.5분)까지 낭비하는 문제가 있었다(실제로 741초짜리가 로그에서 관측됨).
      // 반면 연결 자체가 안 되는 경우(ECONNREFUSED 등 - 워커가 아직 안 떴거나 다운된 경우)는
      // 그 워커만의 문제이므로 다른 워커로 넘어가는 게 여전히 맞다 — 이 둘을 구분한다.
      const isTimeout = e?.code === "ECONNABORTED" || /timeout/i.test(e?.message || "");
      if (isTimeout) {
        logG2b(`hwp-worker 타임아웃(${workerUrl}, 파일 자체 문제일 가능성) - 재시도 없이 실패 확정: ${e?.message || e}`);
        // 다른 워커로도, 로컬 LibreOffice로도 재시도하지 않는다 — 같은 이유(파일 자체 문제)로
        // 어차피 오래 걸리기만 하고 결과는 같을 가능성이 높기 때문.
        return "";
      }
      logG2b(`hwp-worker 연결 오류(${workerUrl}) - 다음 워커 시도: ${e?.message || e}`);
    } finally {
      hwpWorkerInFlight[idx]--;
    }
  }
  logG2b(`모든 hwp-worker(${HWP_WORKER_URLS.join(", ")}) 연결 실패 - 로컬 LibreOffice로 폴백`);
  return null;
}

// hwp/hwpx를 브라우저 미리보기용 PDF로 변환한다(첨부파일 "미리보기" 클릭 시 호출).
// extractHwpTextViaWorker와 동일하게 pickHwpWorkerOrder()로 가장 한가한 워커부터
// 시도하고, 텍스트 추출용 in-flight 카운트(hwpWorkerInFlight)를 그대로 같이 쓴다 —
// 텍스트 추출과 PDF 변환은 결국 같은 워커 풀의 CPU를 나눠 쓰는 작업이라, 부하 추적을
// 분리하지 않아야 서로의 대기시간에 실제로 영향을 준다는 게 정확히 반영된다.
// 로컬 LibreOffice 폴백은 두지 않는다 — 미리보기는 "생성 안 되면 다운로드해서 보면
// 그만"인 부가 기능이라, 실패 시 그냥 안내 메시지를 보여주는 편이 낫다고 판단했다.
async function convertHwpToPdfViaWorker(buf, ext) {
  if (HWP_WORKER_URLS.length === 0) return null;
  const order = pickHwpWorkerOrder();

  for (let i = 0; i < order.length; i++) {
    const idx = order[i];
    const workerUrl = HWP_WORKER_URLS[idx];
    hwpWorkerInFlight[idx]++;
    try {
      const res = await axios.post(`${workerUrl}/convert?ext=${ext}&format=pdf`, buf, {
        headers: { "Content-Type": "application/octet-stream" },
        timeout: 75000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300 && res.data) {
        if (res.data.success && res.data.pdfBase64) {
          logG2b(`hwp-worker PDF 미리보기 변환 완료 (${workerUrl})`);
          return Buffer.from(res.data.pdfBase64, "base64");
        }
        logG2b(`hwp-worker PDF 변환 실패 응답 (${workerUrl}): ${res.data.reason || "unknown"}`);
        return null; // 이 파일 자체가 안 되는 경우 - 다른 워커로 돌려도 마찬가지일 가능성이 높음
      }
      logG2b(`hwp-worker 비정상 응답(status ${res.status}) - 다음 워커 시도: ${workerUrl}`);
    } catch (e) {
      const isTimeout = e?.code === "ECONNABORTED" || /timeout/i.test(e?.message || "");
      if (isTimeout) {
        logG2b(`hwp-worker PDF 변환 타임아웃(${workerUrl}) - 재시도 없이 실패 확정: ${e?.message || e}`);
        return null;
      }
      logG2b(`hwp-worker 연결 오류(${workerUrl}) - 다음 워커 시도: ${e?.message || e}`);
    } finally {
      hwpWorkerInFlight[idx]--;
    }
  }
  logG2b(`모든 hwp-worker(${HWP_WORKER_URLS.join(", ")}) PDF 변환 연결 실패`);
  return null;
}

// LibreOffice가 hwp/hwpx를 PDF로 변환할 때, 원본 문서 속성에 남아있던 깨진 "제목"을
// 그대로 PDF의 /Title 메타데이터로 옮기는 경우가 있다 — 실제로 실제 파일명이 아니라
// "<5BBAD9C0D3355D20...>" 같은 알아볼 수 없는 16진 문자열이 크롬 PDF 뷰어 좌측 상단에
// 뜨는 문제로 확인됐다. 프론트에서 blob을 File 객체로 감싸 이름을 넘겨도 소용없는
// 이유가 이것 — 크롬 PDF 뷰어는 File 이름보다 PDF 안에 박힌 /Title을 우선해서 보여준다.
// 그래서 변환 직후 pdf-lib로 PDF를 열어 /Title을 우리가 이미 알고 있는 실제 첨부파일명
// (게시글의 attachments 메타에 저장된 원본 이름)으로 명시적으로 덮어써서 캐싱한다.
// 이 단계가 실패해도 미리보기 자체는 계속 되도록 - 실패 시 제목만 못 고친 채 원본
// 변환 결과를 그대로 반환한다.
async function fixPdfTitle(pdfBuf, title) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuf, { updateMetadata: false, ignoreEncryption: true });
    pdfDoc.setTitle(title);
    return Buffer.from(await pdfDoc.save());
  } catch (e) {
    logG2b(`미리보기 PDF 제목 메타데이터 수정 실패(원본 변환 결과 그대로 사용): ${e?.message || e}`);
    return pdfBuf;
  }
}

// 워커 컨테이너(worker/index.js)의 SOFFICE_TIMEOUT_MS와 동일한 값 — 정상 파일은
// 실제로 관찰해보니 거의 다 수 초~10초 안에 끝나고, 몇 분씩 걸리는 건 결국 실패로
// 끝나는 "말썽 파일"뿐이라 240초에서 60초로 줄였다. 로컬 LibreOffice 폴백 경로도
// 같은 이유가 그대로 적용되므로 동일하게 맞춘다 (실제로 겪은 문제 기준 조정값).
const SOFFICE_TIMEOUT_MS = 60000;

async function extractHwpTextViaLibreOffice(tmpFilePath, deadlineAt) {
  return runSofficeSerialized(async () => {
    const outDir = path.join(HWP_TMP_DIR, crypto.randomUUID());
    fs.mkdirSync(outDir, { recursive: true });
    const baseName = path.basename(tmpFilePath, path.extname(tmpFilePath));
    const txtPath = path.join(outDir, `${baseName}.txt`);
    const startedAt = Date.now();
    const fileLabel = path.basename(tmpFilePath);
    try {
      let fileSize = 0;
      try { fileSize = fs.statSync(tmpFilePath).size; } catch { /* 무시 */ }
      logG2b(`LibreOffice 변환 시작: ${fileLabel} (${fileSize} bytes)`);

      // soffice.exe(런처)는 실제 변환이 끝나기 전에 먼저 반환될 수 있으므로,
      // execFile 콜백 자체는 참고만 하고 실패해도 즉시 포기하지 않는다.
      await new Promise((resolve) => {
        execFile(
          SOFFICE_CMD,
          ["--headless", "--norestore", "--convert-to", "txt:Text (encoded):UTF8", "--outdir", outDir, tmpFilePath],
          { timeout: SOFFICE_TIMEOUT_MS, cwd: SOFFICE_CWD },
          () => resolve() // 성공/실패 여부와 무관하게, 실제 완료 여부는 아래에서 파일로 재확인
        );
      });

      // 결과 파일이 실제로 완성될 때까지 대기 — 단, 이 파일 전체(1차+2차)에 허용된
      // 예산(deadlineAt)을 넘기지 않도록 남은 시간만큼만 기다린다.
      const remainingMs = Math.max(5000, (deadlineAt ?? Date.now() + SOFFICE_TIMEOUT_MS) - Date.now());
      const ok = await waitForFileStable(txtPath, { maxWaitMs: Math.min(SOFFICE_TIMEOUT_MS, remainingMs) });

      if (!ok) {
        // 예산을 넘겨서 포기하는 시점 — sofficeQueue로 직렬화되어 있어 지금 시스템에
        // 남아있는 soffice.bin은 100% 이 파일 것뿐이므로 안전하게 강제 종료한다.
        logG2b(`LibreOffice 변환 타임아웃 (${Date.now() - startedAt}ms 경과) - soffice.bin 강제 종료: ${fileLabel}`);
        await killAllSofficeBin();
        // taskkill 직후 OS가 파일 핸들을 실제로 반환할 때까지 약간의 여유를 둔다
        // (곧바로 .lock을 지우려 하면 아직 핸들이 안 풀려 실패할 수 있음).
        await new Promise((r) => setTimeout(r, 500));
        cleanupStaleSofficeLock();
        return "";
      }

      // 백그라운드 soffice.bin이 완전히 종료될 때까지 대기 (다음 파일과의 충돌 방지, 최대 30초 추가 대기)
      await waitForSofficeBinExit();

      if (fs.existsSync(txtPath)) {
        const text = fs.readFileSync(txtPath, "utf8");
        logG2b(`LibreOffice 변환 완료 (${Date.now() - startedAt}ms, ${text.length}자): ${fileLabel}`);
        return text;
      }
      logG2b(`LibreOffice 변환 결과 파일 없음 (${Date.now() - startedAt}ms): ${fileLabel}`);
      return "";
    } catch (e) {
      console.error("hwp LibreOffice 폴백(2차) 실행 오류:", e?.message || e);
      logG2b(`LibreOffice 변환 오류 (${Date.now() - startedAt}ms): ${fileLabel} - ${e?.message || e}`);
      return "";
    } finally {
      try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* 무시 */ }
    }
  });
}

// hwp/hwpx/doc/docx/pdf 각각에 맞는 텍스트 추출 파이프라인을 한 곳에 모아둔 함수.
// 최상위 첨부파일 처리(extractAttachmentText)와 zip 내부 항목 처리(extractZipText)
// 양쪽에서 재사용한다. doc/docx는 hwp/hwpx와 완전히 동일한 경로(hwp-worker 우선,
// 없으면 로컬 LibreOffice)를 탄다 — LibreOffice가 애초에 doc/docx도 지원하는 포맷이라
// 별도 로직이 필요 없고, hwp-worker 쪽 확장자 화이트리스트만 doc/docx를 포함하도록
// 넓혀주면 된다.
async function extractTextForFileType(buf, fileType, deadlineAt) {
  if (fileType === "pdf") {
    return await extractPdfText(buf);
  }

  // hwp/hwpx/doc/docx: 실제 형식에 맞는 확장자로 임시파일을 저장해야 LibreOffice가
  // 올바른 가져오기 필터를 선택한다.
  const tmpFilePath = path.join(HWP_TMP_DIR, `${crypto.randomUUID()}.${fileType}`);
  fs.writeFileSync(tmpFilePath, buf);
  try {
    let text = "";
    if (fileType === "hwp") {
      // 1차 시도 (hwpx/doc/docx는 hwpjs가 지원하지 않는 포맷이라 바로 2차로 감)
      text = await extractHwpTextViaHwpjs(tmpFilePath);
    }
    if (!text || text.trim().length === 0) {
      const workerText = await extractHwpTextViaWorker(buf, fileType);
      text = workerText !== null ? workerText : await extractHwpTextViaLibreOffice(tmpFilePath, deadlineAt);
    }
    return text || "";
  } finally {
    if (fs.existsSync(tmpFilePath)) {
      try { fs.unlinkSync(tmpFilePath); } catch { /* 무시 */ }
    }
  }
}

// zip 첨부파일 내부의 pdf/hwp/hwpx/doc/docx 파일들을 열어 텍스트를 추출하고 전부
// 하나로 합쳐 반환한다(키워드 매칭은 이 합쳐진 텍스트를 대상으로 수행됨). zip 안의
// zip·엑셀 파일, 그 외 지원하지 않는 형식은 건너뛴다 — 재귀적으로 파고들면 끝이 없고
// 요청받은 범위(zip 안의 문서 파일)를 벗어난다. 압축 폭탄성 zip으로 크롤링 시간
// 전체가 밀리는 걸 막기 위해 처리할 항목 수에 상한을 두고, 넘치면 로그로 남긴다.
const ZIP_ENTRY_SUPPORTED_EXTS = new Set(["pdf", "hwp", "hwpx", "doc", "docx"]);
const ZIP_MAX_ENTRIES = 15;

async function extractZipText(buf, deadlineAt) {
  let entries;
  try {
    entries = new AdmZip(buf).getEntries().filter((e) => !e.isDirectory);
  } catch (e) {
    logG2b(`  ㄴ zip 압축 해제 실패: ${e?.message || e}`);
    return "";
  }

  const targets = entries.filter((e) => {
    const ext = (e.entryName.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
    if (!ZIP_ENTRY_SUPPORTED_EXTS.has(ext)) return false;
    // 최상위 첨부파일과 동일하게, 보안서약서 등 표준 서식은 zip 안에 들어있어도 제외한다.
    // 단, 일부 구버전 zip(EUC-KR로 압축)은 한글 파일명이 깨져서 나오는 경우가 있어
    // 이 필터가 못 걸러낼 수 있다 — 그런 경우는 그냥 검사 대상에 포함된다.
    if (isExcludedBoilerplateAttachment(e.entryName)) {
      logG2b(`  ㄴ zip 내부 표준 서식(보안서약서 등) - 검사 대상 제외: ${e.entryName}`);
      return false;
    }
    return true;
  });
  if (targets.length > ZIP_MAX_ENTRIES) {
    logG2b(`  ㄴ zip 내부 검사 대상 파일 ${targets.length}개 중 ${ZIP_MAX_ENTRIES}개만 처리(나머지는 건너뜀)`);
  }

  const texts = [];
  for (const entry of targets.slice(0, ZIP_MAX_ENTRIES)) {
    const ext = (entry.entryName.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
    try {
      const entryBuf = entry.getData();
      if (entryBuf.length === 0) continue;
      if (entryBuf.length > HWP_MAX_SIZE_BYTES) {
        logG2b(`  ㄴ zip 내부 파일 용량 초과(${entryBuf.length} bytes) - 건너뜀: ${entry.entryName}`);
        continue;
      }
      const text = await extractTextForFileType(entryBuf, ext, deadlineAt);
      logG2b(`  ㄴ zip 내부 파일 처리(${ext}): ${entry.entryName} (${text ? text.length : 0}자)`);
      if (text && text.trim().length > 0) texts.push(text);
    } catch (e) {
      logG2b(`  ㄴ zip 내부 파일 처리 오류: ${entry.entryName} - ${e?.message || e}`);
    }
  }
  return texts.join("\n\n");
}

// 반환값: { text, failed } — failed=true는 "키워드가 없어서 매칭 안 됨"이 아니라
// "다운로드/추출 자체가 실패해서 내용을 확인할 수 없었음"을 뜻한다. 호출부에서 이 둘을
// 구분해서, failed인 경우엔 조용히 건너뛰지 않고 "확인 필요"로 게시판에 남긴다.
// 반환값에 text/failed 외에 buf(다운로드한 원본 바이트)·fileType·filename(원본 파일명)도
// 함께 담아 돌려준다 — 호출자(runG2bCrawlRule)가 텍스트 매칭뿐 아니라, 이미 다운로드한
// 첨부파일을 그대로 게시글에 등록할 수 있도록 하기 위함이다. 다운로드 자체가 실패한
// 경우(catch 블록)에는 buf가 없으므로 null로 둔다.
// 사전규격/제안요청서 공고에는 사업 내용과 무관하게 거의 매번 붙는 "표준 서식류"
// 첨부파일들이 있다(보안서약서, 개인정보 동의서 등). 이런 서식 안의 일반적인 문구가
// 검색 키워드와 우연히 겹쳐서 매칭되는 오탐(false positive)을 막기 위해, 이런 파일은
// 아예 검사(텍스트 추출/키워드 매칭) 대상에서 제외한다 — 등록(첨부) 자체는 그대로 된다.
// 공백·괄호·가운뎃점(․/・/·) 등 표기가 문서마다 제각각이라(예: "제안서 작성요령" vs
// "제안서 작성 요령", "개인(업체)정보 제공․활용 동의서") 한글/영문/숫자만 남기고 전부
// 제거한 뒤 부분일치로 비교한다 — 그래야 실제 파일명에 붙는 번호·괄호·확장자 등과
// 무관하게 안정적으로 걸러진다.
const G2B_EXCLUDED_ATTACHMENT_TITLES = [
  "제안서 작성요령",
  "제안서 작성 요령",
  "제안서 작성지침",
  "제안서 제출안내",
  "보안 서약서",
  "보안조치 시행 확약서",
  "비밀유지협약서",
  "자료 관리대장",
  "개인(업체)정보 제공․활용 동의서",
  "개인(신용)정보 제공․활용 동의서",
  "제안서 작성 방법",
  "제안서 제출",
  "입찰시 제출서류",
  "세부작성 지침",
  "비밀유지 의무",
  "권리의무의 양도",
  "제안서 및 제안서 요약",
  "하도급계약의 승인 및 통보",
  "공동수급협정서",
  "검수 요청",
].map(normalizeForMatch);

function normalizeForMatch(s) {
  return String(s || "").replace(/[^가-힣a-zA-Z0-9]/g, "");
}

function isExcludedBoilerplateAttachment(filename) {
  if (!filename) return false;
  const normalized = normalizeForMatch(filename);
  return G2B_EXCLUDED_ATTACHMENT_TITLES.some((title) => normalized.includes(title));
}

// 파일명이 아니라 "문서 안의 한 구간"이 표준 서식 내용인 경우도 있다 — 예: 제안요청서
// 본문 하나에 붙임으로 보안서약서·개인정보 동의서 페이지가 같이 들어있는 경우, 그
// 페이지 안에서만 검색어가 우연히 매칭되는 오탐을 막아야 한다. 이럴 땐 파일 전체를
// 빼는 게 아니라, "표준 서식 제목이 줄 전체(또는 거의 전체)를 차지하는 줄"을
// 그 서식의 시작(헤딩)으로 보고, 그 지점부터 일정 분량(문단 다음 헤딩을 정확히 알 수
// 없으므로 표준 서식류가 보통 한두 페이지 안에 끝난다는 점에 착안해 넉넉히 잡은
// 고정 길이)만큼을 본문에서 들어내고 나서 키워드를 검사한다.
const BOILERPLATE_SECTION_STRIP_CHARS = 1500; // 공백(스페이스·탭·줄바꿈) 제외하고 센 글자 수 기준

function isBoilerplateHeadingLine(line) {
  const trimmed = String(line || "").trim();
  // 헤딩은 보통 그 줄에 제목만 짧게 있다 - 긴 문장 중간에 우연히 들어간 언급까지
  // 헤딩으로 오인하지 않도록 줄 길이를 제한한다(번호·붙임·괄호 등 여유를 감안한 값).
  if (!trimmed || trimmed.length > 40) return false;
  const normalized = normalizeForMatch(trimmed);
  if (!normalized) return false;
  return G2B_EXCLUDED_ATTACHMENT_TITLES.some((title) => normalized.includes(title));
}

function stripBoilerplateSections(text) {
  const lines = String(text || "").split(/\r?\n/);
  const kept = [];
  let skippedChars = 0;
  let skipping = false;
  for (const line of lines) {
    if (!skipping && isBoilerplateHeadingLine(line)) {
      skipping = true;
      skippedChars = 0;
      continue; // 헤딩 줄 자체도 제거
    }
    if (skipping) {
      // 공백은 실제 서식 내용 분량으로 안 치므로 세지 않는다 - "공백 제외 1000자" 기준.
      skippedChars += line.replace(/\s/g, "").length;
      if (skippedChars >= BOILERPLATE_SECTION_STRIP_CHARS) skipping = false;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

async function extractAttachmentText(url) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + HWP_EXTRACT_HARD_TIMEOUT_MS;
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; M2SOFT-SFA-Bot/1.0)" },
      maxRedirects: 5,
    });
    const buf = Buffer.from(res.data);
    const { type: fileType, filename } = detectAttachmentType(buf, res.headers);
    const fileMeta = { buf, fileType, filename };

    // 보안서약서/개인정보 동의서 등 표준 서식은 위에서 설명한 대로 검사 대상에서
    // 제외한다 - 엑셀과 마찬가지로 "의도적으로 안 본 것"이라 failed:false로 돌려줘야
    // "⚠️ 확인 필요" 게시글이 만들어지지 않는다.
    if (isExcludedBoilerplateAttachment(filename)) {
      logG2b(`첨부파일 표준 서식(보안서약서 등) - 검사 대상 제외: ${filename} (${url})`);
      return { text: "", failed: false, ...fileMeta };
    }

    // 엑셀 계열(xls/xlsx/xlsm/xlsb)은 의도적으로 검사 대상에서 뺀 것이지, 읽지 못해서
    // 실패한 게 아니다 — 그래서 failed:false로 돌려준다. failed:true를 주면 호출부가
    // "키워드가 있는지 확인 못 했다"고 보고 "⚠️ 확인 필요" 게시글을 만드는데, 엑셀은
    // 애초에 검사할 생각이 없으므로 그 취급을 받으면 안 된다 — 그냥 "이 첨부파일엔
    // 키워드가 없었다"와 동일하게(=매칭 안 됨) 조용히 넘어가야 한다.
    if (fileType === "excel") {
      logG2b(`첨부파일 엑셀 파일(xls/xlsx/xlsm/xlsb) - 요청에 따라 검사에서 제외(확인 필요 처리하지 않음): ${url}`);
      return { text: "", failed: false, ...fileMeta };
    }

    // 그 외 형식 미지원(hwp/hwpx/doc/docx/pdf/zip 아님)은 진짜 뭔지 알 수 없는 경우라
    // "키워드가 없다"고 단정할 수 없으므로 기존대로 확인 필요 처리한다.
    if (fileType === "other") {
      logG2b(`첨부파일 형식 미지원(hwp/hwpx/doc/docx/pdf/zip 아님) - 추출 시도 없이 확인 필요 처리: ${url}`);
      return { text: "", failed: true, ...fileMeta };
    }

    // 용량이 너무 큰 첨부파일은 추출이 느리거나 실패할 가능성이 높아
    // (hwp 3.8MB·4.9MB 파일도 각각 8~9분씩 걸렸던 전례) 아예 시도하지 않고 바로
    // "추출 실패"로 처리해 확인 필요 게시판 항목으로 넘긴다 — 시간 낭비 없이 누락도 방지.
    if (buf.length > HWP_MAX_SIZE_BYTES) {
      logG2b(`첨부파일(${fileType}) 용량 초과(${buf.length} bytes > ${HWP_MAX_SIZE_BYTES} bytes) - 추출 시도 없이 확인 필요 처리: ${url}`);
      return { text: "", failed: true, ...fileMeta };
    }

    if (fileType === "zip") {
      logG2b(`zip 처리 시작: ${url} (${buf.length} bytes)`);
      const rawText = await extractZipText(buf, deadlineAt);
      // failed는 반드시 "추출 자체가 됐는지"를 원문(rawText) 기준으로 판단해야 한다 -
      // 표준 서식 구간을 제거한 결과(text)가 우연히 텅 비어도(문서 전체가 서식인 경우)
      // 그건 "추출 실패"가 아니라 "의도적으로 검사 안 함"이라 확인 필요 처리하면 안 된다.
      const failed = !rawText || rawText.trim().length === 0;
      const text = stripBoilerplateSections(rawText);
      logG2b(`zip 처리 ${failed ? "완전 실패" : "완료"} (${Date.now() - startedAt}ms, ${rawText.length}자 → 표준서식 제외 후 ${text.length}자): ${url}`);
      return { text, failed, ...fileMeta };
    }

    // pdf/hwp/hwpx/doc/docx
    logG2b(`${fileType} 처리 시작: ${url} (${buf.length} bytes)`);
    const rawText = await extractTextForFileType(buf, fileType, deadlineAt);
    const failed = !rawText || rawText.trim().length === 0;
    const text = stripBoilerplateSections(rawText);
    logG2b(`${fileType} 처리 ${failed ? "완전 실패" : "완료"} (${Date.now() - startedAt}ms, ${rawText.length}자 → 표준서식 제외 후 ${text.length}자): ${url}`);
    return { text, failed, ...fileMeta };
  } catch (e) {
    logG2b(`첨부파일 다운로드/처리 오류 (${Date.now() - startedAt}ms): ${url} - ${e?.message || e}`);
    return { text: "", failed: true, buf: null, fileType: null, filename: null };
  }
}

// extractAttachmentText와 달리 텍스트 추출(hwpjs/LibreOffice 변환)을 전혀 하지 않는
// 가벼운 다운로드 전용 함수 — 키워드 검색은 이미 끝났고, 첨부파일 등록만을 위해 나머지
// 파일을 마저 받아올 때 사용한다. 변환 비용이 없으므로 워커/로컬 LibreOffice에 부하를
// 주지 않는다.
async function downloadAttachmentRaw(url) {
  try {
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 20000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; M2SOFT-SFA-Bot/1.0)" },
      maxRedirects: 5,
    });
    const buf = Buffer.from(res.data);
    const { type: fileType, filename } = detectAttachmentType(buf, res.headers);
    return { buf, fileType, filename };
  } catch (e) {
    logG2b(`첨부파일 등록용 다운로드 실패: ${url} - ${e?.message || e}`);
    return null;
  }
}

function g2bMatchesKeyword(text, keyword) {
  return String(text || "").toLowerCase().includes(keyword.toLowerCase());
}

// ── 나라장터 원문(사전규격 상세) 링크 생성 ──
// 나라장터 사전규격 상세페이지의 안정적인 직접 딥링크 URL 패턴이 확인되지 않아,
// 검증된 나라장터 메인 페이지로 연결한다. 게시글 본문에 표시되는 사전규격등록번호와
// 사업명을 이용해 나라장터 내 검색창에서 직접 찾아야 한다.
function buildG2bDetailUrl(bfSpecRgstNo, title) {
  return `https://www.g2b.go.kr`;
}

function formatBudget(amt) {
  const n = Number(amt);
  if (isNaN(n) || n === 0) return "미정";
  return n.toLocaleString("ko-KR") + "원";
}

// ── 실제 크롤링 실행 (나라장터 규칙 1개 처리) ─────────────────
async function runG2bCrawlRule(rule) {
  g2bRunningRuleIds.add(rule.id);
  // "실행 중..." 버튼에 진행률을 보여주기 위한 진행 상황 갱신 헬퍼.
  const updateProgress = (patch) => {
    const cur = g2bProgressByRuleId.get(rule.id) || {};
    g2bProgressByRuleId.set(rule.id, { ...cur, ...patch });
  };
  updateProgress({ phase: "fetching", total: 0, done: 0, collected: 0, startedAt: Date.now() });

  // 아래 전체를 try/finally로 감싸서, 중간에 return하는 경로(예: 게시판을 찾을 수 없는 경우)를
  // 포함해 어떤 경로로 끝나든 g2bRunningRuleIds/g2bProgressByRuleId 정리가 항상 실행되도록 한다.
  // (예전엔 게시판을 못 찾은 경우 정리 코드에 도달하지 못해 "실행 중" 상태가 영구히 안 풀리는
  //  버그가 있었다.)
  try {
    const boards = readBoards();
    const board = boards.find(b => b.id === rule.boardId);
    if (!board) {
      addG2bLog({
        id: crypto.randomUUID(), ruleId: rule.id, ranAt: new Date().toISOString(),
        status: "failed", collected: 0, duplicates: 0, titleMatched: 0, attachMatched: 0, errorMsg: "게시판을 찾을 수 없음",
      });
      return;
    }

    const existingPosts = readPosts(rule.boardId);
    const existingRefs = new Set(existingPosts.map(p => p.g2bRefNo).filter(Boolean));
    const remainingSlots = () => BOARD_POST_LIMIT - existingPosts.length;

    const isFirstRun = !rule.lastRunAt;
    const today = new Date();
    // 최초 백필 기간: "SW사업 대상만"(swBizObjYn === "Y")으로 좁혀 검색하는 경우는 대상
    // 자체가 적으므로 더 넉넉히 3주(21일), 그 외(전체/SW사업 대상 아님만)는 1주(7일)로 잡는다.
    const firstRunBackfillDays = rule.swBizObjYn === "Y" ? 21 : 7;
    const startDate = isFirstRun
      ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - firstRunBackfillDays)
      : new Date(rule.lastRunAt);
    const endDate = today;

    let collected = 0;
    let duplicates = 0;
    let titleMatched = 0;
    let attachMatched = 0;
    let extractFailed = 0;
    let errorMsg = null;
    let stoppedByLimit = false;
    let succeeded = false;

    try {
      const items = await fetchG2bPreSpecForRule(rule, startDate, endDate);

      // 업무구분 필터 (일반용역/기술용역/물품) — 용역 오퍼레이션은 일반용역+기술용역을
      // 함께 반환하므로, 그중 규칙에서 선택하지 않은 쪽을 여기서 걸러낸다.
      const bizFiltered = items.filter(item => {
        if (!rule.bizTypes || rule.bizTypes.length === 0) return true;
        return rule.bizTypes.includes(item.bsnsDivNm);
      });
      updateProgress({ phase: "processing", total: bizFiltered.length, done: 0 });

      // 공고를 하나씩 완전히 끝내고 다음으로 넘어가던 방식(순차 처리)은, hwp 워커를
      // 몇 개를 띄워두든 실제로는 항상 딱 하나의 첨부파일만 처리 중이라 워커 개수를
      // 늘려도 속도가 거의 그대로였다 (실제로 겪은 문제 — 라운드로빈은 매 호출마다
      // "다른 워커부터 시도"할 뿐, 여러 요청을 동시에 내보내는 게 아니었음).
      // 그래서 HWP_WORKER_URLS에 설정된 워커 개수만큼 동시에 공고를 처리해 실제로
      // 여러 컨테이너를 동시에 활용하도록 바꾼다. 워커가 없어 로컬 LibreOffice만 쓰는
      // 경우엔 로컬 LibreOffice가 sofficeQueue로 어차피 완전히 직렬화되어 있어
      // 동시성을 줘도 이득 없이 리소스 경합만 생기므로 1(기존과 동일)로 고정한다.
      const G2B_CONCURRENCY = HWP_WORKER_URLS.length > 0 ? HWP_WORKER_URLS.length : 1;

      let cursor = 0;
      let doneCount = 0;

      // 공고 하나를 검사해서 매칭되면 existingPosts/카운터에 반영한다. 여러 러너가
      // 동시에 이 함수를 돌 수 있으므로, 공유 상태(existingPosts, 각종 카운터)를
      // 건드리는 부분은 전부 await 없이(=동기적으로, 다른 러너가 끼어들 틈 없이)
      // 처리해 경합을 피한다.
      const processOneItem = async (item) => {
        const refNo = item.bfSpecRgstNo || item.refNo;
        if (!refNo || existingRefs.has(refNo)) {
          if (refNo && existingRefs.has(refNo)) duplicates++;
          return;
        }
        // 동시에 같은 refNo를 두 러너가 동시에 집는 걸 막기 위해, 매칭 여부와 무관하게
        // 이 시점에 바로 "처리 완료"로 선점한다 — 같은 refNo가 이후 또 나와도 어차피
        // 같은 내용이라 다시 검사할 이유가 없어 동작상 문제되지 않는다.
        existingRefs.add(refNo);

        const title = item.prdctClsfcNoNm || "";
        // SW사업대상여부(swBizObjYn) — 게시글 목록에서 열지 않고도 바로 보이도록 제목에
        // 표시하고, 본문에도 명시적으로 적어둔다.
        const isSwBiz = item.swBizObjYn === "Y";
        const swBizLabel = item.swBizObjYn === "Y" ? "예" : item.swBizObjYn === "N" ? "아니오" : "확인 필요(정보 없음)";
        let matched = false;
        let matchType = "";
        let matchedKw = "";

        // 1단계: 제목 검색
        for (const kw of rule.keywords) {
          if (g2bMatchesKeyword(title, kw)) {
            matched = true;
            matchType = "title";
            matchedKw = kw;
            break;
          }
        }

        // 공고의 첨부파일 URL 목록 — 키워드 검색 여부와 무관하게, 매칭이 확정된 공고는
        // 전부 다운로드해 게시글에 등록할 것이므로 검색 단계 이전에 미리 뽑아둔다.
        const fileUrls = [item.specDocFileUrl1, item.specDocFileUrl2, item.specDocFileUrl3, item.specDocFileUrl4, item.specDocFileUrl5]
          .filter(Boolean);

        // 2단계: 첨부파일(hwp/hwpx/pdf) 검색 (제목 검색 옵션이 "title_attach"인 경우만)
        // 실제 형식 판별은 extractAttachmentText 내부에서 다운로드 응답을 검사해 수행한다
        // (URL 자체는 확장자를 노출하지 않아 URL만으로는 형식을 알 수 없다).
        let attachExtractionFailed = false;
        // 다운로드에 성공한 첨부파일은 매칭 성공 여부와 무관하게 여기 모아두었다가,
        // 실제로 게시글을 만들 때(아래) 그대로 첨부로 등록한다. downloadedUrls는 이미
        // 받은 URL을 기억해, 매칭 확정 후 "나머지 첨부파일 마저 등록" 단계에서 같은
        // 파일을 두 번 받지 않도록 한다.
        const downloadedAttachments = [];
        const downloadedUrls = new Set();
        if (!matched && rule.searchScope === "title_attach") {
          for (const fileUrl of fileUrls) {
            const { text, failed, buf, fileType, filename } = await extractAttachmentText(fileUrl);
            if (failed) attachExtractionFailed = true;
            if (buf) { downloadedAttachments.push({ buf, fileType, filename }); downloadedUrls.add(fileUrl); }
            for (const kw of rule.keywords) {
              if (g2bMatchesKeyword(text, kw)) {
                matched = true;
                matchType = "attach";
                matchedKw = kw;
                break;
              }
            }
            if (matched) break;
            await new Promise(r => setTimeout(r, 300));
          }

          // 제목에도 안 걸리고 첨부파일도 키워드가 안 걸렸지만, 그중 하나라도 추출 자체가
          // 실패했다면 "키워드가 없다"고 단정할 수 없다 — 조용히 건너뛰지 않고 "확인 필요"로
          // 게시판에 올려서 사람이 직접 확인하도록 한다 (자동 매칭이 놓칠 수 있는 사업을 방지).
          if (!matched && attachExtractionFailed) {
            matched = true;
            matchType = "extract_failed";
          }
        }

        if (!matched) return;

        // 게시판 상한 마지막 재확인 — 이 체크와 바로 아래 push 사이엔 await이 없어
        // 동기적으로 실행되므로, 여러 러너가 막바지에 동시에 몰려도 상한을 정확히 지킨다.
        if (remainingSlots() <= 0) {
          stoppedByLimit = true;
          return;
        }

        // 게시글로 등록이 확정된 공고는, 검색 단계에서 아직 받지 않은 나머지 첨부파일도
        // 등록만을 위해 마저 받아온다(제목 매칭이면 전부, 첨부 매칭이면 매칭된 파일 이후
        // 나머지). 이 단계는 텍스트 추출(hwpjs/LibreOffice 변환)을 전혀 거치지 않는 단순
        // 다운로드라 워커 부하 없이 빠르게 끝난다 — 검색은 이미 끝났으므로 다시 하지 않는다.
        for (const fileUrl of fileUrls) {
          if (downloadedUrls.has(fileUrl)) continue;
          const raw = await downloadAttachmentRaw(fileUrl);
          if (raw) { downloadedAttachments.push(raw); downloadedUrls.add(fileUrl); }
        }

        const isExtractFailed = matchType === "extract_failed";
        const content = isExtractFailed
          ? [
              `⚠️ 이 공고는 첨부파일(hwp)을 자동으로 읽지 못해 키워드가 있는지 확인하지 못했습니다.`,
              `아래 링크에서 직접 확인해주세요.`,
              "",
              `사업명: ${title}`,
              `SW사업대상여부: ${swBizLabel}`,
              `발주기관: ${item.orderInsttNm || "-"}`,
              `수요기관: ${item.rlDminsttNm || "-"}`,
              `배정예산: ${formatBudget(item.asignBdgtAmt)}`,
              `접수일시: ${item.rcptDt || "-"}`,
              `의견등록마감: ${item.opninRgstClseDt || "-"}`,
              `담당자: ${item.ofclNm || "-"} (${item.ofclTelNo || "-"})`,
              "",
              `사전규격등록번호: ${refNo}`,
              `나라장터 바로가기: ${buildG2bDetailUrl(refNo, title)}`,
            ].join("\n")
          : [
              `사업명: ${title}`,
              `SW사업대상여부: ${swBizLabel}`,
              `발주기관: ${item.orderInsttNm || "-"}`,
              `수요기관: ${item.rlDminsttNm || "-"}`,
              `배정예산: ${formatBudget(item.asignBdgtAmt)}`,
              `접수일시: ${item.rcptDt || "-"}`,
              `의견등록마감: ${item.opninRgstClseDt || "-"}`,
              `담당자: ${item.ofclNm || "-"} (${item.ofclTelNo || "-"})`,
              "",
              `사전규격등록번호: ${refNo}`,
              `※ 나라장터(g2b.go.kr) 접속 후 위 등록번호 또는 사업명으로 검색하시면 상세 내용을 확인하실 수 있습니다.`,
              "",
              `나라장터 바로가기: ${buildG2bDetailUrl(refNo, title)}`,
            ].join("\n");

        // 이미 다운로드해둔 첨부파일을 게시글 첨부파일 저장소에 실제로 저장하고, 수동
        // 업로드 게시글과 동일한 메타데이터 형식(name|storedFilename|size 를 ; 로 구분)을
        // 구성한다 — 게시글 상세에서 바로 다운로드할 수 있게 하기 위함.
        let attachmentsMeta = "";
        if (downloadedAttachments.length > 0) {
          try {
            const attachDir = path.join(POST_ATTACH_DIR, rule.boardId);
            fs.mkdirSync(attachDir, { recursive: true });
            attachmentsMeta = downloadedAttachments.slice(0, BOARD_ATTACH_MAX_FILES).map(({ buf, fileType, filename }, i) => {
              const extGuess = (filename && path.extname(filename).replace(/^\./, "")) || (fileType && fileType !== "other" ? fileType : "bin");
              const storedName = `${crypto.randomUUID()}.${extGuess}`;
              fs.writeFileSync(path.join(attachDir, storedName), buf);
              const origName = filename || `첨부파일${i + 1}.${extGuess}`;
              return `${encodeURIComponent(origName)}|${storedName}|${buf.length}`;
            }).join(";");
          } catch (e) {
            logG2b(`첨부파일 저장 실패(ruleId=${rule.id}, refNo=${refNo}): ${e?.message || e}`);
          }
        }

        const nowStr = new Date().toISOString().split("T")[0];
        const newPost = {
          id: crypto.randomUUID(),
          boardId: rule.boardId,
          title: isExtractFailed
            ? `⚠️ [확인 필요] ${isSwBiz ? "[SW] " : ""}${title}`
            : `${isSwBiz ? "[SW] " : ""}${title}`,
          content,
          author: "g2b-crawler",
          team: board.team === "both" ? "both" : board.team,
          createdAt: (item.rcptDt || nowStr).split(" ")[0] || nowStr,
          updatedAt: nowStr,
          views: 0,
          thumbnail: "",
          url: buildG2bDetailUrl(refNo, title),
          sourceName: item.orderInsttNm || "",
          attachments: attachmentsMeta,
          isAutoCollected: "true",
          matchedKeyword: matchedKw,
          g2bRefNo: refNo,
          g2bMatchType: matchType,
        };

        existingPosts.push(newPost);
        collected++;
        updateProgress({ collected });
        if (matchType === "title") titleMatched++;
        else if (matchType === "attach") attachMatched++;
        else extractFailed++;
      };

      // G2B_CONCURRENCY개의 러너가 공유 커서(cursor)를 하나씩 뽑아가며 동시에 처리한다.
      // 러너 개수만큼 실제로 여러 공고(=여러 첨부파일)가 동시에 진행되므로, 워커
      // 컨테이너 여러 개를 늘린 만큼 실제 처리량이 늘어난다.
      const runner = async () => {
        while (true) {
          if (stoppedByLimit || remainingSlots() <= 0) { stoppedByLimit = true; return; }
          const idx = cursor++;
          if (idx >= bizFiltered.length) return;
          try {
            await processOneItem(bizFiltered[idx]);
          } catch (e) {
            logG2b(`공고 처리 중 오류(ruleId=${rule.id}): ${e?.message || e}`);
          } finally {
            doneCount++;
            updateProgress({ done: doneCount });
          }
        }
      };

      await Promise.all(Array.from({ length: G2B_CONCURRENCY }, () => runner()));

      existingPosts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      writePosts(rule.boardId, existingPosts);

      addG2bLog({
        id: crypto.randomUUID(), ruleId: rule.id, ranAt: new Date().toISOString(),
        status: "success", collected, duplicates, titleMatched, attachMatched, extractFailed,
        errorMsg: stoppedByLimit ? `게시판 게시글 상한(${BOARD_POST_LIMIT}개) 도달로 중단됨` : null,
      });
      succeeded = true;
    } catch (e) {
      errorMsg = e?.message || String(e);
      logG2b(`규칙 실행 실패 (ruleId=${rule.id}) status=${e?.response?.status ?? "-"} errorMsg=${errorMsg}`);
      addG2bLog({
        id: crypto.randomUUID(), ruleId: rule.id, ranAt: new Date().toISOString(),
        status: "failed", collected, duplicates, titleMatched, attachMatched, extractFailed, errorMsg,
      });
    }

    // lastRunAt 갱신 (성공했을 때만 — 실패 시 갱신하면 다음 실행이 실패 시점부터 조회하게 되어
    // 실패 구간에 올라온 사전규격 공고를 영영 놓치게 된다. 실패하면 다음 실행이 마지막 "성공"
    // 시점부터 다시 조회하도록 lastRunAt을 그대로 둔다.)
    if (succeeded) {
      const rules = readG2bRules();
      const idx = rules.findIndex(r => r.id === rule.id);
      if (idx !== -1) {
        rules[idx].lastRunAt = new Date().toISOString();
        writeG2bRules(rules);
      }
    }
  } finally {
    g2bRunningRuleIds.delete(rule.id);
    g2bProgressByRuleId.delete(rule.id);
  }
}

// ── 나라장터 스케줄러 관리 ────────────────────────────────────
const g2bScheduledTasks = new Map();
const g2bRunningRuleIds = new Set(); // 현재 실행 중인 규칙 ID 추적
// 실행 중인 규칙의 진행 상황(조회 대상 총 건수 / 처리한 건수 등) — "실행 중..." 버튼에
// 진행률을 보여주기 위한 용도. running 상태와 마찬가지로 메모리에만 있고, 실행이
// 끝나면(성공/실패 무관) 지운다.
const g2bProgressByRuleId = new Map();

function scheduleG2bRule(rule) {
  if (g2bScheduledTasks.has(rule.id)) {
    g2bScheduledTasks.get(rule.id).stop();
    g2bScheduledTasks.delete(rule.id);
  }
  if (!rule.enabled) return;

  const cronExpr = `${rule.minute ?? 0} ${rule.hour ?? 2} * * *`; // 매일 고정
  const task = cron.schedule(cronExpr, () => {
    runG2bCrawlRule(rule).catch(e => console.error("나라장터 크롤링 실행 오류:", e));
  }, { timezone: "Asia/Seoul" });

  g2bScheduledTasks.set(rule.id, task);
}

function rescheduleAllG2b() {
  const rules = readG2bRules();
  rules.forEach(scheduleG2bRule);
}
rescheduleAllG2b();

// ── 로그 월별 압축 보관 스케줄 ──
// 매달 1일 00:10(Asia/Seoul)에 방금 끝난 지난 달 로그를 압축하고 원본 날짜별
// 파일은 삭제한다. 서버가 그 시각에 꺼져있었을 경우를 대비해, 시작 시에도
// 한 번 확인해서 아직 압축되지 않은 지난 달(들)이 있으면 처리한다.
cron.schedule("10 0 1 * *", () => {
  archivePreviousMonthLogs();
}, { timezone: "Asia/Seoul" });
archiveAllPastMonths();

// 게시판 삭제 시 그 게시판에 연결된 나라장터 규칙(들)을 정리한다 (스케줄 정지 + 파일에서 제거).
function deleteG2bRulesForBoard(boardId) {
  const rules = readG2bRules();
  const remaining = rules.filter(r => {
    if (r.boardId !== boardId) return true;
    if (g2bScheduledTasks.has(r.id)) {
      g2bScheduledTasks.get(r.id).stop();
      g2bScheduledTasks.delete(r.id);
    }
    g2bRunningRuleIds.delete(r.id);
    return false;
  });
  if (remaining.length !== rules.length) writeG2bRules(remaining);
}

// ── API: 나라장터 크롤링 규칙 CRUD ────────────────────────────
app.get("/api/boards/:boardId/g2b-rule", requirePassword, requireAdmin, (req, res) => {
  const rules = readG2bRules();
  const rule = rules.find(r => r.boardId === req.params.boardId);
  res.json(rule || null);
});

app.post("/api/boards/:boardId/g2b-rule", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId } = req.params;
    const { enabled, keywords, searchScope, bizTypes, swBizObjYn, hour, minute } = req.body || {};

    if (!Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: "keywords required" });
    }

    const rules = readG2bRules();
    const idx = rules.findIndex(r => r.boardId === boardId);

    const ruleData = {
      id: idx !== -1 ? rules[idx].id : crypto.randomUUID(),
      boardId,
      enabled: enabled !== false,
      keywords,
      searchScope: searchScope === "title_attach" ? "title_attach" : "title",
      bizTypes: Array.isArray(bizTypes) && bizTypes.length > 0 ? bizTypes : ["일반용역", "기술용역"],
      // SW사업대상여부 검색조건: "Y"(대상만)/"N"(대상 아님만)/""(전체, 기본값)
      swBizObjYn: swBizObjYn === "Y" || swBizObjYn === "N" ? swBizObjYn : "",
      hour: hour ?? 2,
      minute: minute ?? 0,
      lastRunAt: idx !== -1 ? rules[idx].lastRunAt : null,
      createdAt: idx !== -1 ? rules[idx].createdAt : new Date().toISOString(),
    };

    if (idx !== -1) rules[idx] = ruleData;
    else rules.push(ruleData);

    writeG2bRules(rules);
    scheduleG2bRule(ruleData);

    logAccess(req, "G2B_RULE_SAVE", boardId);
    res.json(ruleData);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/boards/:boardId/g2b-rule", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId } = req.params;
    const rules = readG2bRules();
    const idx = rules.findIndex(r => r.boardId === boardId);
    if (idx === -1) return res.status(404).json({ error: "not found" });

    const ruleId = rules[idx].id;
    if (g2bScheduledTasks.has(ruleId)) {
      g2bScheduledTasks.get(ruleId).stop();
      g2bScheduledTasks.delete(ruleId);
    }
    rules.splice(idx, 1);
    writeG2bRules(rules);

    logAccess(req, "G2B_RULE_DELETE", boardId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post("/api/boards/:boardId/g2b-rule/run-now", requirePassword, requireAdmin, async (req, res) => {
  try {
    const { boardId } = req.params;
    const rules = readG2bRules();
    const rule = rules.find(r => r.boardId === boardId);
    if (!rule) return res.status(404).json({ error: "규칙이 없습니다" });

    runG2bCrawlRule(rule).catch(e => console.error("나라장터 즉시 실행 오류:", e));
    logAccess(req, "G2B_RUN_NOW", boardId);
    res.json({ ok: true, message: "나라장터 크롤링이 시작되었습니다" });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/boards/:boardId/g2b-logs", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId } = req.params;
    const rules = readG2bRules();
    const rule = rules.find(r => r.boardId === boardId);
    if (!rule) return res.json([]);

    const logs = readG2bLogs().filter(l => l.ruleId === rule.id);
    res.json(logs.slice(0, 20));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ── 나라장터 크롤링 실행 중 여부 조회 (폴링용) ────────────────
app.get("/api/boards/:boardId/g2b-rule/status", requirePassword, requireAdmin, (req, res) => {
  try {
    const { boardId } = req.params;
    const rules = readG2bRules();
    const rule = rules.find(r => r.boardId === boardId);
    if (!rule) return res.json({ running: false, progress: null });
    const running = g2bRunningRuleIds.has(rule.id);
    const progress = running ? (g2bProgressByRuleId.get(rule.id) || null) : null;
    res.json({ running, progress });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});


app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[M2SOFT SFA backend] listening on http://0.0.0.0:${PORT}`);
  console.log(`  CSV  : ${CSV_PATH}`);
  console.log(`  CATS : ${CATS_PATH}`);
  console.log(`  Files: ${UPLOAD_DIR}`);
  console.log(`  Logs : ${LOG_DIR}`);
});