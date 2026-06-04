import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse as csvParse } from "csv-parse/sync";
import { stringify as csvStringify } from "csv-stringify/sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const CSV_PATH = path.join(DATA_DIR, "presentations.csv");
const CATS_PATH = path.join(DATA_DIR, "categories.json");

const PORT = Number(process.env.PORT) || 4000;


const PWD_PATH = path.join(DATA_DIR, "passwords.json");

function readPasswords() {
  try {
    if (fs.existsSync(PWD_PATH)) {
      return JSON.parse(fs.readFileSync(PWD_PATH, "utf8"));
    }
  } catch {}
  return {
    sales: process.env.APP_PASSWORD_SALES || "2188s",
    eng: process.env.APP_PASSWORD_ENG || "2188e",
  };
}

function writePasswords(data) {
  fs.writeFileSync(PWD_PATH, JSON.stringify(data, null, 2), "utf8");
}

const TEAMS = ["sales", "eng"];

function teamForPassword(pwd) {
  if (!pwd) return null;
  const pwds = readPasswords();
  for (const t of TEAMS) if (pwds[t] === pwd) return t;
  return null;
}



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
  "src", "mime", "fileName", "createdAt", "team",
];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CSV_PATH)) {
  fs.writeFileSync(CSV_PATH, csvStringify([CSV_HEADERS]), "utf8");
}
if (!fs.existsSync(CATS_PATH)) {
  fs.writeFileSync(CATS_PATH, JSON.stringify({}), "utf8");
}

// ------- CSV helpers -------
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

function requirePassword(req, res, next) {
  const team = teamForPassword(req.header("x-app-password"));
  if (!team) return res.status(401).json({ error: "unauthorized" });
  req.team = team;
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
  const team = teamForPassword(password);
  if (team) return res.json({ ok: true, team });
  return res.status(401).json({ ok: false });
});

app.post("/api/change-password", requirePassword, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "invalid" });
    }
    const trimmed = String(newPassword).trim();

    // 최소 길이 검증
    if (trimmed.length < 4) {
      return res.status(400).json({ error: "invalid" });
    }

    const pwds = readPasswords();

    // 현재 비밀번호 확인
    if (pwds[req.team] !== String(currentPassword)) {
      return res.status(400).json({ error: "invalid" });
    }

    // 현재 비밀번호와 동일한 경우
    if (pwds[req.team] === trimmed) {
      return res.status(400).json({ error: "invalid" });
    }

    // 타 팀 비밀번호와 중복 검증 (동일 메시지로 처리)
    const otherTeams = TEAMS.filter((t) => t !== req.team);
    for (const t of otherTeams) {
      if (pwds[t] === trimmed) {
        return res.status(400).json({ error: "invalid" });
      }
    }

    pwds[req.team] = trimmed;
    writePasswords(pwds);
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

app.post("/api/categories", requirePassword, (req, res) => {
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
    res.json(newCat);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/api/categories/:key", requirePassword, (req, res) => {
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
    cats[idx] = { ...cats[idx], label: trimmed };
    const all = readAllCats();
    all[req.team] = cats;
    writeAllCats(all);
    res.json(cats[idx]);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/categories/:key", requirePassword, (req, res) => {
  try {
    const cats = getCatsForTeam(req.team);
    const next = cats.filter((c) => c.key !== req.params.key);
    const all = readAllCats();
    all[req.team] = next;
    writeAllCats(all);
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
    const team = teamForPassword(pwd);
    if (!team) return res.status(401).send("unauthorized");
    const item = readAll().find(
      (p) => p.id === req.params.id && p.sourceType === "file" && p.team === team,
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

app.post("/api/presentations", requirePassword, upload.single("file"), async (req, res) => {
  try {
    const { name, category, sourceType, url } = req.body || {};
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
      };
    } else if (sourceType === "url") {
      if (!url) return res.status(400).json({ error: "url required" });
      entry = {
        id: crypto.randomUUID(), name: String(name).trim(),
        category: String(category), sourceType: "url",
        src: String(url).trim(), mime: "", fileName: "",
        createdAt: Date.now(), team: req.team,
      };
    } else {
      return res.status(400).json({ error: "bad sourceType" });
    }
    await serialize(async () => {
      const list = readAll();
      list.push(entry);
      writeAll(list);
    });
    res.json(publicizeFileSrc(req, entry));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/presentations/:id", requirePassword, async (req, res) => {
  try {
    await serialize(async () => {
      const list = readAll();
      const target = list.find((p) => p.id === req.params.id && p.team === req.team);
      if (!target) return;
      const next = list.filter((p) => p.id !== req.params.id);
      writeAll(next);
      if (target && target.sourceType === "file") {
        const stillReferenced = next.some((p) => p.sourceType === "file" && p.src === target.src);
        if (!stillReferenced) {
          const abs = path.join(__dirname, target.src);
          if (abs.startsWith(UPLOAD_DIR) && fs.existsSync(abs)) {
            try { fs.unlinkSync(abs); } catch {}
          }
        }
      }
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.patch("/api/presentations/:id", requirePassword, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name required" });
    }
    const trimmed = String(name).trim();
    let updated = null;
    await serialize(async () => {
      const list = readAll();
      const idx = list.findIndex((p) => p.id === req.params.id && p.team === req.team);
      if (idx === -1) return;
      list[idx] = { ...list[idx], name: trimmed };
      updated = list[idx];
      writeAll(list);
    });
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(publicizeFileSrc(req, updated));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[M2SOFT SFA backend] listening on http://0.0.0.0:${PORT}`);
  console.log(`  CSV : ${CSV_PATH}`);
  console.log(`  CATS: ${CATS_PATH}`);
  console.log(`  Files: ${UPLOAD_DIR}`);
});