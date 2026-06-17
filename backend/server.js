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
  "src", "mime", "fileName", "createdAt", "team", "openMode",
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
  }));
}

function writeAll(list) {
  const out = [CSV_HEADERS, ...list.map((p) => CSV_HEADERS.map((h) => p[h] ?? ""))];
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

app.post("/api/change-password", requirePassword, requireAdmin, (req, res) => {
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
    if (pwds[req.team]?.admin !== String(currentPassword)) {
      return res.status(400).json({ error: "invalid" });
    }
    for (const t of TEAMS) {
      for (const r of ROLES) {
        if (pwds[t]?.[r] === trimmed) {
          return res.status(400).json({ error: "invalid" });
        }
      }
    }
    pwds[req.team].admin = trimmed;
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
    const { name, category, sourceType, url, openMode } = req.body || {};
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
      };
    } else if (sourceType === "url") {
      if (!url) return res.status(400).json({ error: "url required" });
      entry = {
        id: crypto.randomUUID(), name: String(name).trim(),
        category: String(category), sourceType: "url",
        src: String(url).trim(), mime: "", fileName: "",
        createdAt: Date.now(), team: req.team,
        openMode: openMode === "new_tab" ? "new_tab" : "inline",
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
    const { name, openMode } = req.body || {};
    if (!name && !openMode) {
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

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[M2SOFT SFA backend] listening on http://0.0.0.0:${PORT}`);
  console.log(`  CSV  : ${CSV_PATH}`);
  console.log(`  CATS : ${CATS_PATH}`);
  console.log(`  Files: ${UPLOAD_DIR}`);
  console.log(`  Logs : ${LOG_DIR}`);
});