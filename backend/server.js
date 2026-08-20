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
import * as cheerio from "cheerio";
import cron from "node-cron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const LOG_DIR = path.join(__dirname, "logs");
const CSV_PATH = path.join(DATA_DIR, "presentations.csv");
const CATS_PATH = path.join(DATA_DIR, "categories.json");
const ACCESS_LOG_PATH = path.join(LOG_DIR, "access.log");
const DEBUG_LOG_PATH = path.join(LOG_DIR, "debug.log");

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

// ------- 로깅 -------
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ` +
         `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
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
  writeLog(DEBUG_LOG_PATH, line);
}

function logAccess(req, action, detail = "") {
  const ip = getClientIp(req);
  const geo = getGeoInfo(ip);
  const browser = getBrowserInfo(req.headers["user-agent"]);
  const team = req.team || "-";
  const role = req.role || "-";
  const detailStr = detail ? ` | ${detail}` : "";
  const line = `${getTimestamp()} | ${ip} | ${geo} | ${team}/${role} | ${browser} | ${action}${detailStr}`;
  writeLog(ACCESS_LOG_PATH, line);
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
    if (item.mime) res.setHeader("Content-Type", item.mime);
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(item.fileName || item.name)}`,
    );
    req.team = auth.team;
    req.role = auth.role;
    logAccess(req, "FILE_VIEW", item.name);
    fs.createReadStream(abs).pipe(res);
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

const POST_HEADERS = ["id","boardId","title","content","author","team","createdAt","updatedAt","views","thumbnail","url","sourceName","attachments","isAutoCollected","matchedKeyword"];

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

// ── 게시글 첨부파일 업로드 설정 (최대 3개, 파일당 200MB) ────
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
  limits: { fileSize: 200 * 1024 * 1024, files: 3 },
});

// ── 게시글 작성 (첨부파일 최대 3개) ───────────────────────
app.post("/api/boards/:boardId/posts", requirePassword, boardAttachUpload.array("files", 3), (req, res) => {
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
app.patch("/api/boards/:boardId/posts/:postId", requirePassword, requireAdmin, boardAttachUpload.array("files", 3), (req, res) => {
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

    const combined = [...existing, ...newOnes].slice(0, 3);
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

const BOARD_POST_LIMIT = 1000; // 게시판 전체 게시글 수 상한

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

  // 게시판 내 가장 최신 게시글의 날짜 (정기 실행 시 이 날짜 이후 기사만 수집)
  let sinceDate = null;
  if (!isFirstRun && existingPosts.length > 0) {
    const dates = existingPosts.map(p => new Date(p.createdAt)).filter(d => !isNaN(d.getTime()));
    if (dates.length > 0) sinceDate = new Date(Math.max(...dates));
  }

  const remainingSlots = () => BOARD_POST_LIMIT - existingPosts.length;

  let collected = 0;
  let duplicates = 0;
  let errorMsg = null;
  let stoppedByLimit = false;

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
        candidateItems = sorted.slice(0, rule.maxInitialBackfill || 100);
      } else {
        // 정기/즉시 실행: 최신순으로 가져오되 sinceDate 이후 기사만, maxPerRun개까지
        const items = await searchNaverNews(keyword, 100, 1); // 최신순 최대 100개
        const filtered = items.filter(item => {
          const pub = parsePubDate(item.pubDate);
          const dateOk = sinceDate ? (pub && pub > sinceDate) : true;
          return dateOk && matchesScope(item);
        });
        candidateItems = filtered.slice(0, rule.maxPerRun || 5);
      }

      for (const item of candidateItems) {
        if (remainingSlots() <= 0) { stoppedByLimit = true; break; }
        if (isFirstRun && collected >= (rule.maxInitialBackfill || 100)) break;
        if (!isFirstRun && collected >= (rule.maxPerRun || 5)) break;

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
  } catch (e) {
    errorMsg = e?.message || String(e);
    addCrawlLog({
      id: crypto.randomUUID(), ruleId: rule.id, ranAt: new Date().toISOString(),
      status: "failed", collected, duplicates, errorMsg,
    });
  }

  // lastRunAt 갱신
  const rules = readCrawlRules();
  const idx = rules.findIndex(r => r.id === rule.id);
  if (idx !== -1) {
    rules[idx].lastRunAt = new Date().toISOString();
    writeCrawlRules(rules);
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
      maxInitialBackfill: maxInitialBackfill || 100,
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


app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[M2SOFT SFA backend] listening on http://0.0.0.0:${PORT}`);
  console.log(`  CSV  : ${CSV_PATH}`);
  console.log(`  CATS : ${CATS_PATH}`);
  console.log(`  Files: ${UPLOAD_DIR}`);
  console.log(`  Logs : ${LOG_DIR}`);
});