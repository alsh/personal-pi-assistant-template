import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs, appendFileSync, existsSync, chmodSync, mkdirSync, realpathSync, statSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const execFileAsync = promisify(execFile);

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_CONFIG_PATH = path.join(PACKAGE_ROOT, "personal-assistant.json");
export const MAX_RESULT_CHARS = 20_000;
export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_FILES = 2_000;
const MAX_ARCHIVE_ENTRIES = 50;
const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".org", ".orgmode", ".txt", ".text", ".edm", ".xml", ".json", ".csv", ".tsv", ".html", ".htm", ".log",
 ]);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ".pdf", ".zip"]);
const IGNORED_DIRECTORY_NAMES = new Set([".git", "node_modules", ".cache", "backups", "credentials", "secrets"]);

function isoNow() {
  return new Date().toISOString();
}

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveFromCwd(cwd, value) {
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd, expanded);
}

function tryChmod(target, mode) {
  try {
    chmodSync(target, mode);
  } catch {
    // Non-POSIX filesystems may not implement chmod. The caller can still use
    // the resulting permission check/doctor output as an explicit warning.
  }
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  tryChmod(directory, 0o700);
  const mode = statSync(directory).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`Private data directory is not owner-only: mode ${mode.toString(8)}`);
  }
}

function hardenDatabaseFiles(dbPath) {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(file)) tryChmod(file, 0o600);
  }
}

function safeJson(value) {
  return JSON.stringify(value ?? {});
}

function normalizeText(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function truncateUtf8(value, maxBytes) {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return { text: value, truncated: false };
  return {
    text: `${buffer.subarray(0, maxBytes).toString("utf8")}\n[Document text truncated at ${maxBytes} bytes]`,
    truncated: true,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(filePath, maxBytes) {
  const data = await fs.readFile(filePath);
  if (data.byteLength > maxBytes) throw new Error(`file exceeds configured size limit (${maxBytes} bytes)`);
  return sha256(data);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRelativeTarget(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("targetPath is required");
  const normalized = value.trim().replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("\0")) throw new Error("targetPath must be relative");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "..")) throw new Error("targetPath may not escape the configured root");
  return parts.join("/");
}

function rootLabel(cwd, rootPath) {
  const relative = path.relative(cwd, rootPath).replaceAll(path.sep, "/");
  return relative && !relative.startsWith("..") ? relative : `<configured:${path.basename(rootPath)}>`;
}

function mimeForExtension(extension) {
  return ({
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".org": "text/plain",
    ".orgmode": "text/plain",
    ".txt": "text/plain",
    ".text": "text/plain",
    ".edm": "application/xml",
    ".xml": "application/xml",
    ".json": "application/json",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".html": "text/html",
    ".htm": "text/html",
    ".log": "text/plain",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
  })[extension] ?? "application/octet-stream";
}

function titleFor(filePath, content) {
  const heading = content.match(/^\s*(?:#|\*+)\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.slice(0, 240);
  return path.basename(filePath, path.extname(filePath));
}

function extractMetadata(filePath, content, size) {
  const extension = path.extname(filePath).toLowerCase();
  const isoDates = [...content.matchAll(/\b(20\d{2})[-.](\d{2})[-.](\d{2})\b/g)].map((match) => `${match[1]}-${match[2]}-${match[3]}`);
  const documentType = extension === ".pdf" ? "pdf" : extension === ".zip" ? "archive" : extension === ".edm" || extension === ".xml" ? "xml" : "text";
  return { documentType, dates: [...new Set(isoDates)].slice(0, 32), byteSize: size };
}

function hasBinaryBytes(buffer) {
  return buffer.subarray(0, Math.min(buffer.byteLength, 1_000_000)).includes(0);
}

function safeArchiveEntry(entry) {
  const normalized = entry.replaceAll("\\", "/");
  return Boolean(normalized) && !normalized.startsWith("/") && !normalized.split("/").includes("..") && !normalized.startsWith("-");
}

async function extractZipText(filePath, maxTextBytes, signal) {
  const listing = await execFileAsync("unzip", ["-Z1", filePath], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 256 * 1024,
    signal,
  });
  const entries = listing.stdout.split(/\r?\n/).filter((entry) => {
    const extension = path.extname(entry).toLowerCase();
    return safeArchiveEntry(entry) && TEXT_EXTENSIONS.has(extension);
  }).slice(0, MAX_ARCHIVE_ENTRIES);
  const pieces = [];
  let used = 0;
  for (const entry of entries) {
    try {
      const result = await execFileAsync("unzip", ["-p", filePath, entry], {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: Math.min(maxTextBytes, 256 * 1024),
        signal,
      });
      const chunk = normalizeText(result.stdout);
      const section = `\n--- archive entry: ${entry} ---\n${chunk}`;
      used += Buffer.byteLength(section, "utf8");
      if (used > maxTextBytes) break;
      pieces.push(section);
    } catch {
      // A single malformed/binary entry must not make the whole archive unusable.
    }
  }
  return pieces.join("").trim();
}

export async function extractDocumentText(filePath, { maxTextBytes = DEFAULT_MAX_TEXT_BYTES, signal } = {}) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") {
    try {
      const result = await execFileAsync("pdftotext", ["-layout", filePath, "-"], {
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: maxTextBytes * 2,
        signal,
      });
      return { ...truncateUtf8(normalizeText(result.stdout), maxTextBytes), extraction: "pdftotext" };
    } catch (error) {
      return { text: "", truncated: false, extraction: "pdf-unavailable" };
    }
  }
  if (extension === ".zip") {
    try {
      return { ...truncateUtf8(await extractZipText(filePath, maxTextBytes, signal), maxTextBytes), extraction: "zip-text-entries" };
    } catch (error) {
      return { text: "", truncated: false, extraction: "zip-unavailable" };
    }
  }
  if (!TEXT_EXTENSIONS.has(extension)) return { text: "", truncated: false, extraction: "metadata-only" };
  const buffer = await fs.readFile(filePath);
  if (hasBinaryBytes(buffer)) return { text: "", truncated: false, extraction: "binary-skipped" };
  return { ...truncateUtf8(normalizeText(buffer.toString("utf8")), maxTextBytes), extraction: "utf8" };
}

async function collectFiles(rootPath, { maxFiles, maxFileBytes }) {
  const files = [];
  async function walk(directory) {
    if (files.length >= maxFiles) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
        await walk(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const filePath = path.join(directory, entry.name);
      const extension = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(extension)) continue;
      const stat = await fs.stat(filePath);
      if (stat.size > maxFileBytes) continue;
      files.push({ filePath, stat, extension });
    }
  }
  await walk(rootPath);
  return files;
}

const NOTE_EXTENSIONS = new Set([".md", ".markdown", ".org", ".orgmode", ".txt", ".text"]);
function normalizeNotePath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("notePath is required");
  let normalized = value.trim().replaceAll("\\", "/");
  if (!path.extname(normalized)) normalized += ".md";
  if (normalized.startsWith("/") || normalized.includes("\0")) throw new Error("notePath must be relative");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === ".." || part.startsWith("."))) throw new Error("notePath may not escape or hide outside the notes directory");
  const extension = path.extname(normalized).toLowerCase();
  if (!NOTE_EXTENSIONS.has(extension)) throw new Error("notePath must use Markdown, Org, or plain-text format");
  return parts.join("/");
}
function absoluteNotePath(runtime, notePath) {
  const normalized = normalizeNotePath(notePath);
  const absolute = path.resolve(runtime.notesDir, normalized);
  if (!isWithin(runtime.notesDir, absolute)) throw new Error("notePath escapes the notes directory");
  return { normalized, absolute };
}
function noteExcerpt(content, query = "") {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const tokens = queryTokens(query);
  const lower = clean.toLowerCase();
  const at = tokens.map((token) => lower.indexOf(token.toLowerCase())).filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 160);
  const end = Math.min(clean.length, start + 720);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}
async function readNoteFile(runtime, filePath, query = "") {
  const content = normalizeText(await fs.readFile(filePath, "utf8"));
  const stat = await fs.stat(filePath);
  const relativePath = path.relative(runtime.notesDir, filePath).replaceAll(path.sep, "/");
  return {
    path: relativePath,
    title: titleFor(filePath, content),
    modifiedAt: stat.mtime.toISOString(),
    excerpt: noteExcerpt(content, query),
    content,
  };
}
function noteMatches(content, query) {
  const tokens = queryTokens(query).map((token) => token.toLowerCase());
  const lower = content.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}
export async function listNotes(runtime, { query = "", limit = 100 } = {}) {
  const boundedLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const files = await collectFiles(runtime.notesDir, { maxFiles: runtime.config.maxFiles, maxFileBytes: runtime.config.maxFileBytes });
  const notes = [];
  for (const file of files.filter((entry) => NOTE_EXTENSIONS.has(entry.extension))) {
    const note = await readNoteFile(runtime, file.filePath, query);
    if (!query || noteMatches(note.content, query)) {
      const { content, ...summary } = note;
      notes.push(summary);
    }
  }
  return notes.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, boundedLimit);
}
export async function readNote(runtime, notePath, { maxChars = MAX_RESULT_CHARS } = {}) {
  const { normalized, absolute } = absoluteNotePath(runtime, notePath);
  const stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("note must be a regular file, not a symlink");
  const note = await readNoteFile(runtime, absolute);
  return { ...note, path: normalized, content: truncateUtf8(note.content, Math.min(MAX_RESULT_CHARS, maxChars)).text };
}
export async function createNote(runtime, { notePath, content = "", actor = "assistant", sessionId = null } = {}) {
  const { normalized, absolute } = absoluteNotePath(runtime, notePath);
  if (existsSync(absolute)) throw new Error(`note already exists: ${normalized}`);
  ensurePrivateDirectory(path.dirname(absolute));
  const cleanContent = normalizeText(String(content));
  await fs.writeFile(absolute, cleanContent, { encoding: "utf8", mode: 0o600 });
  tryChmod(absolute, 0o600);
  audit(runtime, { actor, sessionId, operation: "create_note", result: "ok", details: { notePath: normalized } });
  return readNote(runtime, normalized);
}
export async function writeNote(runtime, { notePath, content, actor = "assistant", sessionId = null } = {}) {
  const { normalized, absolute } = absoluteNotePath(runtime, notePath);
  const stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("note must be a regular file, not a symlink");
  const cleanContent = normalizeText(String(content));
  await fs.writeFile(absolute, cleanContent, { encoding: "utf8", mode: 0o600 });
  tryChmod(absolute, 0o600);
  audit(runtime, { actor, sessionId, operation: "write_note", result: "ok", details: { notePath: normalized } });
  return readNote(runtime, normalized);
}
export async function appendNote(runtime, { notePath, content, actor = "assistant", sessionId = null } = {}) {
  const { normalized, absolute } = absoluteNotePath(runtime, notePath);
  const stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("note must be a regular file, not a symlink");
  const current = await fs.readFile(absolute, "utf8");
  const addition = String(content);
  const separator = current.length > 0 && !current.endsWith("\n") ? "\n\n" : current.length > 0 ? "\n" : "";
  await fs.writeFile(absolute, `${current}${separator}${normalizeText(addition)}`, { encoding: "utf8", mode: 0o600 });
  tryChmod(absolute, 0o600);
  audit(runtime, { actor, sessionId, operation: "append_note", result: "ok", details: { notePath: normalized } });
  return readNote(runtime, normalized);
}
export async function getNoteStats(runtime) {
  const files = await collectFiles(runtime.notesDir, { maxFiles: runtime.config.maxFiles, maxFileBytes: runtime.config.maxFileBytes });
  const notes = files.filter((entry) => NOTE_EXTENSIONS.has(entry.extension));
  return { directory: "notes", count: notes.length, bytes: notes.reduce((sum, note) => sum + note.stat.size, 0) };
}
function hasTable(runtime, tableName) {
  return Boolean(runtime.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tableName));
}
function noteSlug(value) {
  const slug = String(value ?? "note").normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return slug || "note";
}
function legacyNotePath(runtime, title, used) {
  const base = noteSlug(title);
  let candidate = `legacy/${base}.md`;
  let suffix = 2;
  while (used.has(candidate) || existsSync(path.join(runtime.notesDir, candidate))) {
    candidate = `legacy/${base}-${suffix}.md`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}
export function legacyNoteSummary(runtime) {
  const cases = hasTable(runtime, "cases") ? runtime.db.prepare(`SELECT title FROM cases ORDER BY created_at`).all() : [];
  const knowledge = hasTable(runtime, "knowledge_notes") ? runtime.db.prepare(`SELECT title FROM knowledge_notes ORDER BY created_at`).all() : [];
  return { caseCount: cases.length, knowledgeCount: knowledge.length, titles: [...cases, ...knowledge].map((row) => row.title).filter(Boolean) };
}
export async function exportLegacyToNotes(runtime, { actor = "assistant", sessionId = null } = {}) {
  const summary = legacyNoteSummary(runtime);
  if (summary.caseCount === 0 && summary.knowledgeCount === 0) return { created: [], skipped: [], summary };
  ensurePrivateDirectory(path.join(runtime.notesDir, "legacy"));
  const used = new Set();
  const created = [];
  const skipped = [];
  const caseRows = hasTable(runtime, "cases") ? runtime.db.prepare(`SELECT * FROM cases ORDER BY created_at`).all() : [];
  for (const record of caseRows) {
    const notePath = legacyNotePath(runtime, record.title, used);
    const lines = [`# ${record.title}`, "", record.description || "(no description recorded)", "", "## Open items", ""];
    const tasks = hasTable(runtime, "tasks") ? runtime.db.prepare(`SELECT * FROM tasks WHERE case_id = ? ORDER BY created_at`).all(record.id) : [];
    if (tasks.length) {
      for (const task of tasks) lines.push(`- [${task.status === "done" ? "x" : " "}] ${task.title}${task.description ? ` — ${task.description}` : ""}${task.due_date ? ` (previous due date: ${task.due_date})` : ""}`);
    } else {
      lines.push("- No checklist items were recorded.");
    }
    if (hasTable(runtime, "case_documents")) {
      const documents = runtime.db.prepare(`SELECT d.relative_path FROM case_documents cd JOIN documents d ON d.id = cd.document_id WHERE cd.case_id = ? ORDER BY cd.linked_at`).all(record.id);
      if (documents.length) {
        lines.push("", "## Related documents", "");
        for (const document of documents) lines.push(`- ${document.relative_path}`);
      }
    }
    const target = path.join(runtime.notesDir, notePath);
    await fs.writeFile(target, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    tryChmod(target, 0o600);
    created.push(notePath);
  }
  if (hasTable(runtime, "knowledge_notes")) {
    const knowledgeRows = runtime.db.prepare(`SELECT * FROM knowledge_notes ORDER BY created_at`).all();
    for (const record of knowledgeRows) {
      const notePath = legacyNotePath(runtime, record.title, used);
      const lines = [`# ${record.title}`, "", record.summary || "", "", record.body || "", "", "## Sources", ""];
      if (hasTable(runtime, "knowledge_sources")) {
        const sources = runtime.db.prepare(`SELECT * FROM knowledge_sources WHERE note_id = ? ORDER BY accessed_at`).all(record.id);
        for (const source of sources) lines.push(`- ${source.title}${source.url ? ` — ${source.url}` : ""}${source.quote ? ` — \"${source.quote.replaceAll(/\s+/g, " ")}\"` : ""}`);
      }
      const target = path.join(runtime.notesDir, notePath);
      await fs.writeFile(target, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
      tryChmod(target, 0o600);
      created.push(notePath);
    }
  }
  audit(runtime, { actor, sessionId, operation: "export_legacy_to_notes", result: "ok", details: { createdCount: created.length } });
  return { created, skipped, summary };
}



function initializeSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      absolute_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      extension TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      extraction TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      indexed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS documents_root_idx ON documents(root_path, status);
    CREATE INDEX IF NOT EXISTS documents_hash_idx ON documents(content_hash);
    CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
      document_id UNINDEXED,
      title,
      content
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      actor TEXT NOT NULL,
      session_id TEXT,
      operation TEXT NOT NULL,
      result TEXT NOT NULL,
      document_id TEXT,
      details_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_events_time_idx ON audit_events(timestamp DESC);
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      approved_at TEXT,
      applied_at TEXT
    );
    CREATE INDEX IF NOT EXISTS proposals_status_idx ON proposals(status, expires_at);
  `);
  try {
    db.exec("ALTER TABLE documents ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
  } catch {
    // Existing Stage 1 databases already have the column.
  }
}

function resolveConfigPath(cwd, explicitPath) {
  const configuredPath = explicitPath ?? process.env.PA_CONFIG_PATH;
  if (configuredPath) return resolveFromCwd(cwd, configuredPath);
  return DEFAULT_CONFIG_PATH;
}

export function loadProjectConfig(cwd = process.cwd(), { configPath } = {}) {
  const projectCwd = path.resolve(cwd);
  const resolvedConfigPath = resolveConfigPath(projectCwd, configPath);
  const configRoot = path.dirname(resolvedConfigPath);
  let fileConfig = {};
  if (existsSync(resolvedConfigPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(resolvedConfigPath, "utf8"));
    } catch (error) {
      throw new Error(`Invalid ${resolvedConfigPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const fixtureRoot = path.join(configRoot, "fixtures", "documents");
  const environmentRoots = process.env.PA_DOCUMENT_ROOTS?.split(path.delimiter).map((value) => value.trim()).filter(Boolean);
  const roots = environmentRoots?.length
    ? environmentRoots
    : (Array.isArray(fileConfig.documentRoots) ? fileConfig.documentRoots.filter((value) => typeof value === "string") : (existsSync(fixtureRoot) ? ["fixtures/documents"] : []));
  return {
    documentRoots: roots,
    documentRootBase: environmentRoots?.length ? projectCwd : configRoot,
    dataDir: typeof fileConfig.dataDir === "string" ? fileConfig.dataDir : "~/.local/share/personal-assistant",
    dataDirBase: configRoot,
    configPath: resolvedConfigPath,
    configRoot,
    maxFileBytes: Number.isSafeInteger(fileConfig.maxFileBytes) && fileConfig.maxFileBytes > 0 ? fileConfig.maxFileBytes : DEFAULT_MAX_FILE_BYTES,
    maxTextBytes: Number.isSafeInteger(fileConfig.maxTextBytes) && fileConfig.maxTextBytes > 0 ? fileConfig.maxTextBytes : DEFAULT_MAX_TEXT_BYTES,
    maxFiles: Number.isSafeInteger(fileConfig.maxFiles) && fileConfig.maxFiles > 0 ? fileConfig.maxFiles : DEFAULT_MAX_FILES,
  };
}

export async function createRuntime({ cwd, config: configOverride = {}, dataDir: dataDirOverride, roots: rootsOverride } = {}) {
  const projectCwd = path.resolve(cwd ?? process.cwd());
  const baseConfig = loadProjectConfig(projectCwd);
  const config = { ...baseConfig, ...configOverride };
  const configuredRoots = rootsOverride ?? config.documentRoots;
  const hasConfiguredRootOverride = Object.prototype.hasOwnProperty.call(configOverride, "documentRoots");
  const rootBase = rootsOverride === undefined && !hasConfiguredRootOverride ? (config.documentRootBase ?? projectCwd) : projectCwd;
  const roots = [];
  for (const configured of configuredRoots) {
    const absolute = resolveFromCwd(rootBase, configured);
    try {
      const real = realpathSync(absolute);
      const stat = statSync(real);
      roots.push({ configured, absolute: real, label: rootLabel(projectCwd, real), exists: stat.isDirectory() });
    } catch (error) {
      roots.push({ configured, absolute, label: configured, exists: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const configuredDataDir = dataDirOverride ?? process.env.PA_DATA_DIR ?? config.dataDir;
  const hasConfiguredDataDirOverride = Object.prototype.hasOwnProperty.call(configOverride, "dataDir");
  const dataDirBase = dataDirOverride !== undefined || process.env.PA_DATA_DIR || hasConfiguredDataDirOverride ? projectCwd : (config.dataDirBase ?? projectCwd);
  const dataDir = resolveFromCwd(dataDirBase, configuredDataDir);
  ensurePrivateDirectory(dataDir);
  const privateDocumentsDir = path.join(dataDir, "documents");
  const extractedDir = path.join(dataDir, "extracted");
  ensurePrivateDirectory(privateDocumentsDir);
  ensurePrivateDirectory(extractedDir);
  const notesDir = path.join(dataDir, "notes");
  ensurePrivateDirectory(notesDir);
  if (!roots.some((root) => root.absolute === privateDocumentsDir)) {
    roots.push({ configured: "<private-documents>", absolute: privateDocumentsDir, label: "private-documents", exists: true, private: true });
  }
  const dbPath = path.join(dataDir, "documents.sqlite");
  const auditPath = path.join(dataDir, "audit.ndjson");
  const db = new DatabaseSync(dbPath);
  initializeSchema(db);
  tryChmod(dbPath, 0o600);
  return {
    cwd: projectCwd,
    config,
    roots,
    dataDir,
    privateDocumentsDir,
    extractedDir,
    notesDir,
    auditPath,
    dbPath,
    db,
    close() {
      hardenDatabaseFiles(dbPath);
      db.close();
    },
  };
}

function rootForDocument(runtime, row) {
  const known = runtime.roots.find((root) => root.absolute === row.root_path);
  return known?.label ?? `<configured:${path.basename(row.root_path)}>`;
}

function publicDocument(row, runtime) {
  return {
    id: row.id,
    root: rootForDocument(runtime, row),
    relativePath: row.relative_path,
    name: row.name,
    extension: row.extension,
    mimeType: row.mime_type,
    size: row.size,
    modifiedAt: new Date(row.mtime_ms).toISOString(),
    contentHash: row.content_hash,
    title: row.title,
    extraction: row.extraction,
    metadata: JSON.parse(row.metadata_json || "{}"),
    tags: JSON.parse(row.tags_json || "[]"),
    status: row.status,
    indexedAt: row.indexed_at,
  };
}

function audit(runtime, { actor = "assistant", sessionId = null, operation, result, documentId = null, details = {} }) {
  const event = { id: `a_${randomUUID()}`, timestamp: isoNow(), actor, operation, result, documentId, details };
  runtime.db.prepare(`INSERT INTO audit_events (id,timestamp,actor,session_id,operation,result,document_id,details_json) VALUES (?,?,?,?,?,?,?,?)`)
    .run(event.id, event.timestamp, event.actor, sessionId, event.operation, event.result, event.documentId, safeJson(event.details));
  try {
    appendFileSync(runtime.auditPath, `${JSON.stringify({ ...event, sessionId })}\n`, { encoding: "utf8", mode: 0o600 });
    tryChmod(runtime.auditPath, 0o600);
  } catch {
    // The derived database audit remains available if the portable audit log cannot be written.
  }
  hardenDatabaseFiles(runtime.dbPath);
}

async function findReplacementCandidate(runtime, rootPath, contentHash, absolutePath) {
  const candidates = runtime.db.prepare(`SELECT id, absolute_path FROM documents WHERE root_path = ? AND status = 'active' AND content_hash = ? AND absolute_path <> ?`).all(rootPath, contentHash, absolutePath);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate.absolute_path);
    } catch {
      return candidate.id;
    }
  }
  return null;
}

export async function indexDocuments(runtime, { actor = "assistant", sessionId = null, signal, onProgress } = {}) {
  const summary = { indexed: 0, skipped: 0, errors: [], duplicates: 0, roots: [] };
  const seenHashes = new Map();
  for (const root of runtime.roots) {
    if (!root.exists) {
      summary.roots.push({ root: root.label, status: "missing" });
      continue;
    }
    let files;
    try {
      files = await collectFiles(root.absolute, runtime.config);
    } catch (error) {
      summary.errors.push(`${root.label}: cannot scan root`);
      summary.roots.push({ root: root.label, status: "error" });
      continue;
    }
    const foundPaths = new Set(files.map((file) => file.filePath));
    for (const old of runtime.db.prepare(`SELECT id, absolute_path FROM documents WHERE root_path = ? AND status = 'active'`).all(root.absolute)) {
      if (!foundPaths.has(old.absolute_path)) runtime.db.prepare(`UPDATE documents SET status = 'missing' WHERE id = ?`).run(old.id);
    }
    for (const [index, file] of files.entries()) {
      if (signal?.aborted) throw new Error("indexing aborted");
      try {
        const rawHash = await hashFile(file.filePath, runtime.config.maxFileBytes);
        const extracted = await extractDocumentText(file.filePath, { maxTextBytes: runtime.config.maxTextBytes, signal });
        const relativePath = path.relative(root.absolute, file.filePath).replaceAll(path.sep, "/");
        const oldByPath = runtime.db.prepare(`SELECT id FROM documents WHERE absolute_path = ?`).get(file.filePath);
        const replacementId = oldByPath?.id ?? await findReplacementCandidate(runtime, root.absolute, rawHash, file.filePath);
        const id = replacementId ?? `doc_${sha256(`${root.absolute}\0${relativePath}`)}`;
        const title = titleFor(file.filePath, extracted.text);
        const indexedAt = isoNow();
        const metadata = extractMetadata(file.filePath, extracted.text, file.stat.size);
        const existing = runtime.db.prepare(`SELECT tags_json, metadata_json FROM documents WHERE id = ?`).get(id);
        runtime.db.prepare(`
          INSERT INTO documents (id,root_path,relative_path,absolute_path,name,extension,mime_type,size,mtime_ms,content_hash,title,content,extraction,metadata_json,tags_json,status,indexed_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            root_path=excluded.root_path,
            relative_path=excluded.relative_path,
            absolute_path=excluded.absolute_path,
            name=excluded.name,
            extension=excluded.extension,
            mime_type=excluded.mime_type,
            size=excluded.size,
            mtime_ms=excluded.mtime_ms,
            content_hash=excluded.content_hash,
            title=excluded.title,
            content=excluded.content,
            extraction=excluded.extraction,
            metadata_json=excluded.metadata_json,
            status='active',
            indexed_at=excluded.indexed_at
        `).run(
          id, root.absolute, relativePath, file.filePath, path.basename(file.filePath), file.extension,
          mimeForExtension(file.extension), file.stat.size, file.stat.mtimeMs, rawHash, title,
          extracted.text, extracted.extraction, safeJson(metadata), existing?.tags_json ?? "[]", "active", indexedAt,
        );
        runtime.db.prepare(`DELETE FROM document_fts WHERE document_id = ?`).run(id);
        runtime.db.prepare(`INSERT INTO document_fts (document_id,title,content) VALUES (?,?,?)`).run(id, title, extracted.text);
        seenHashes.set(rawHash, (seenHashes.get(rawHash) ?? 0) + 1);
        summary.indexed += 1;
        onProgress?.({ root: root.label, current: index + 1, total: files.length, relativePath });
      } catch (error) {
        summary.skipped += 1;
        summary.errors.push(`${root.label}/${path.relative(root.absolute, file.filePath).replaceAll(path.sep, "/")}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    summary.roots.push({ root: root.label, status: "ok", files: files.length });
  }
  summary.duplicates = [...seenHashes.values()].filter((count) => count > 1).length;
  audit(runtime, { actor, sessionId, operation: "index_documents", result: summary.errors.length ? "partial" : "ok", details: { indexed: summary.indexed, skipped: summary.skipped, duplicates: summary.duplicates, roots: summary.roots } });
  hardenDatabaseFiles(runtime.dbPath);
  return summary;
}

function safeImportedBaseName(sourcePath) {
  const base = path.basename(sourcePath).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return base || "document";
}

export async function importDocument(runtime, sourcePath, { mode = "both", actor = "user", sessionId = null, signal } = {}) {
  if (!["both", "text-only", "original-only"].includes(mode)) throw new Error("unsupported import mode");
  if (typeof sourcePath !== "string" || !sourcePath.trim()) throw new Error("source path is required");
  const inputPath = sourcePath.trim().startsWith("@") ? sourcePath.trim().slice(1) : sourcePath.trim();
  const absoluteSource = resolveFromCwd(runtime.cwd, inputPath);
  const sourceStat = await fs.lstat(absoluteSource);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error("source must be a regular file, not a symlink");
  if (signal?.aborted) throw new Error("import aborted");
  const contentHash = await hashFile(absoluteSource, runtime.config.maxFileBytes);
  const extracted = await extractDocumentText(absoluteSource, { maxTextBytes: runtime.config.maxTextBytes, signal });
  const importId = `import_${contentHash.slice(0, 16)}_${randomUUID().slice(0, 8)}`;
  const targetDir = path.join(runtime.privateDocumentsDir, "imported", importId);
  ensurePrivateDirectory(targetDir);
  const sourceBase = safeImportedBaseName(absoluteSource);
  let originalPath;
  let textPath;
  if (mode !== "text-only") {
    const target = path.join(targetDir, sourceBase);
    await fs.copyFile(absoluteSource, target);
    tryChmod(target, 0o600);
    originalPath = path.relative(runtime.dataDir, target).replaceAll(path.sep, "/");
  }
  if (mode !== "original-only") {
    const textName = `${path.basename(sourceBase, path.extname(sourceBase)) || "document"}.txt`;
    const target = mode === "text-only" ? path.join(targetDir, textName) : path.join(runtime.extractedDir, `${importId}.txt`);
    await fs.writeFile(target, extracted.text, { encoding: "utf8", mode: 0o600 });
    tryChmod(target, 0o600);
    textPath = path.relative(runtime.dataDir, target).replaceAll(path.sep, "/");
  }
  const result = {
    importId,
    sourceName: path.basename(absoluteSource),
    mode,
    contentHash,
    size: sourceStat.size,
    extraction: extracted.extraction,
    textBytes: Buffer.byteLength(extracted.text, "utf8"),
    originalPath: originalPath ?? null,
    textPath: textPath ?? null,
  };
  audit(runtime, { actor, sessionId, operation: "import_document", result: "ok", details: { importId, sourceName: result.sourceName, mode, contentHash, size: sourceStat.size, extraction: extracted.extraction, originalCopied: Boolean(originalPath), textWritten: Boolean(textPath) } });
  hardenDatabaseFiles(runtime.dbPath);
  return result;
}


function queryTokens(query) {
  return String(query ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 12);
}

function safeMatchQuery(query) {
  return queryTokens(query).map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

function excerpt(content, query) {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const tokens = queryTokens(query);
  const lower = clean.toLowerCase();
  const at = tokens.map((token) => lower.indexOf(token.toLowerCase())).filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 160);
  const end = Math.min(clean.length, start + 720);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

export function searchDocuments(runtime, query, { limit = 10, actor = "assistant", sessionId = null } = {}) {
  const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  const match = safeMatchQuery(query);
  const rows = match
    ? runtime.db.prepare(`SELECT d.* FROM document_fts JOIN documents d ON d.id = document_fts.document_id WHERE document_fts MATCH ? AND d.status = 'active' ORDER BY rank LIMIT ?`).all(match, boundedLimit)
    : runtime.db.prepare(`SELECT * FROM documents WHERE status = 'active' ORDER BY indexed_at DESC LIMIT ?`).all(boundedLimit);
  const results = rows.map((row) => ({ ...publicDocument(row, runtime), excerpt: excerpt(row.content, query) }));
  audit(runtime, { actor, sessionId, operation: "search_documents", result: "ok", details: { queryLength: String(query ?? "").length, resultCount: results.length } });
  return results;
}

export async function getDocument(runtime, documentId, { includeContent = true, maxChars = MAX_RESULT_CHARS, actor = "assistant", sessionId = null } = {}) {
  const row = runtime.db.prepare(`SELECT * FROM documents WHERE id = ?`).get(documentId);
  if (!row) throw new Error("document not found");
  let content = row.content;
  let currentHash = row.content_hash;
  let stale = false;
  let currentExtraction = row.extraction;
  try {
    const stat = await fs.stat(row.absolute_path);
    currentHash = await hashFile(row.absolute_path, runtime.config.maxFileBytes);
    stale = currentHash !== row.content_hash || stat.mtimeMs !== row.mtime_ms;
    if (includeContent) {
      const extracted = await extractDocumentText(row.absolute_path, { maxTextBytes: runtime.config.maxTextBytes });
      content = extracted.text;
      currentExtraction = extracted.extraction;
    }
  } catch {
    stale = true;
    content = "";
    currentExtraction = "missing-source";
  }
  const document = publicDocument({ ...row, extraction: currentExtraction }, runtime);
  audit(runtime, { actor, sessionId, operation: "read_document", result: "ok", documentId, details: { stale, currentHash } });
  return { document, stale, currentHash, content: includeContent ? truncateUtf8(content, Math.min(MAX_RESULT_CHARS, maxChars)).text : undefined };
}

export function getStatus(runtime) {
  const counts = runtime.db.prepare(`SELECT status, COUNT(*) AS count FROM documents GROUP BY status`).all();
  const proposals = runtime.db.prepare(`SELECT status, COUNT(*) AS count FROM proposals GROUP BY status`).all();
  return {
    dataClass: "C2 document metadata/content; canonical notes are local text files",
    storage: "canonical notes and audit log in the private data directory; SQLite is a derived cache",
    roots: runtime.roots.map((root) => ({ label: root.label, exists: root.exists, status: root.error ? "error" : root.exists ? "ready" : "missing" })),
    documents: Object.fromEntries(counts.map((row) => [row.status, row.count])),
    proposals: Object.fromEntries(proposals.map((row) => [row.status, row.count])),
    capabilities: ["read", "search", "index", "notes", "propose-local-change", "confirm-local-change"],
    prohibited: ["public-share", "remote-write", "delete", "browser-automation"],
  };
}

export function listAudit(runtime, { limit = 20 } = {}) {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return runtime.db.prepare(`SELECT id,timestamp,actor,operation,result,document_id,details_json FROM audit_events ORDER BY timestamp DESC LIMIT ?`).all(boundedLimit).map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    actor: row.actor,
    operation: row.operation,
    result: row.result,
    documentId: row.document_id,
    details: JSON.parse(row.details_json || "{}"),
  }));
}





function getDocumentRow(runtime, documentId) {
  const row = runtime.db.prepare(`SELECT * FROM documents WHERE id = ? AND status = 'active'`).get(documentId);
  if (!row) throw new Error("active document not found");
  return row;
}

function validateTarget(runtime, row, targetPath) {
  const relative = normalizeRelativeTarget(targetPath);
  const target = path.resolve(row.root_path, relative);
  if (!isWithin(row.root_path, target)) throw new Error("targetPath escapes the document root");
  if (existsSync(target)) throw new Error("targetPath already exists");
  return { relative, absolute: target };
}

export function proposeDocumentChange(runtime, { documentId, operation, targetPath, tags, actor = "assistant", sessionId = null } = {}) {
  const row = getDocumentRow(runtime, documentId);
  if (!["rename", "move", "tag"].includes(operation)) throw new Error("unsupported document operation");
  let payload;
  if (operation === "tag") {
    if (!Array.isArray(tags)) throw new Error("tags are required for tag proposals");
    const normalized = [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    if (normalized.some((tag) => tag.length > 60)) throw new Error("tag is too long");
    payload = { tags: normalized };
  } else {
    const target = validateTarget(runtime, row, targetPath);
    payload = { targetPath: target.relative, targetAbsolute: target.absolute };
  }
  const id = `proposal_${randomUUID()}`;
  const createdAt = isoNow();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  runtime.db.prepare(`INSERT INTO proposals (id,document_id,operation,source_hash,payload_json,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, documentId, operation, row.content_hash, safeJson(payload), "proposed", createdAt, expiresAt);
  audit(runtime, { actor, sessionId, operation: "propose_document_change", result: "ok", documentId, details: { proposalId: id, kind: operation } });
  hardenDatabaseFiles(runtime.dbPath);
  return {
    proposalId: id,
    operation,
    document: publicDocument(row, runtime),
    sourceHash: row.content_hash,
    payload: operation === "tag" ? payload : { targetPath: payload.targetPath },
    expiresAt,
    requiresConfirmation: true,
  };
}

function proposalPreview(runtime, proposal, row) {
  const payload = JSON.parse(proposal.payload_json);
  if (proposal.operation === "tag") return `Set local tags on ${row.relative_path} to: ${payload.tags.join(", ") || "(none)"}`;
  return `${proposal.operation === "rename" ? "Rename" : "Move"} ${row.relative_path} to ${payload.targetPath}`;
}

export async function applyDocumentProposal(runtime, proposalId, { confirm, actor = "assistant", sessionId = null } = {}) {
  const proposal = runtime.db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(proposalId);
  if (!proposal) throw new Error("proposal not found");
  if (proposal.status !== "proposed") return { status: proposal.status, applied: false };
  if (Date.parse(proposal.expires_at) <= Date.now()) {
    runtime.db.prepare(`UPDATE proposals SET status = 'expired' WHERE id = ?`).run(proposalId);
    audit(runtime, { actor, sessionId, operation: "apply_document_proposal", result: "expired", documentId: proposal.document_id, details: { proposalId } });
    return { status: "expired", applied: false };
  }
  const row = getDocumentRow(runtime, proposal.document_id);
  const currentHash = await hashFile(row.absolute_path, runtime.config.maxFileBytes);
  if (currentHash !== proposal.source_hash) {
    runtime.db.prepare(`UPDATE proposals SET status = 'stale' WHERE id = ?`).run(proposalId);
    audit(runtime, { actor, sessionId, operation: "apply_document_proposal", result: "stale", documentId: row.id, details: { proposalId } });
    return { status: "stale", applied: false };
  }
  const preview = proposalPreview(runtime, proposal, row);
  const approved = await confirm(preview);
  if (!approved) {
    runtime.db.prepare(`UPDATE proposals SET status = 'rejected' WHERE id = ?`).run(proposalId);
    audit(runtime, { actor, sessionId, operation: "apply_document_proposal", result: "rejected", documentId: row.id, details: { proposalId } });
    return { status: "rejected", applied: false };
  }
  runtime.db.prepare(`UPDATE proposals SET status = 'approved', approved_at = ? WHERE id = ?`).run(isoNow(), proposalId);
  audit(runtime, { actor, sessionId, operation: "confirm_document_proposal", result: "approved", documentId: row.id, details: { proposalId, kind: proposal.operation } });
  try {
    const payload = JSON.parse(proposal.payload_json);
    if (proposal.operation === "tag") {
      runtime.db.prepare(`UPDATE documents SET tags_json = ? WHERE id = ?`).run(safeJson(payload.tags), row.id);
    } else {
      const target = validateTarget(runtime, row, payload.targetPath);
      await fs.rename(row.absolute_path, target.absolute);
      const stat = await fs.stat(target.absolute);
      const contentHash = await hashFile(target.absolute, runtime.config.maxFileBytes);
      const extracted = await extractDocumentText(target.absolute, { maxTextBytes: runtime.config.maxTextBytes });
      const metadata = extractMetadata(target.absolute, extracted.text, stat.size);
      const relativePath = path.relative(row.root_path, target.absolute).replaceAll(path.sep, "/");
      runtime.db.prepare(`UPDATE documents SET relative_path=?, absolute_path=?, name=?, extension=?, mime_type=?, size=?, mtime_ms=?, content_hash=?, title=?, content=?, extraction=?, metadata_json=?, status='active', indexed_at=? WHERE id=?`)
        .run(relativePath, target.absolute, path.basename(target.absolute), path.extname(target.absolute).toLowerCase(), mimeForExtension(path.extname(target.absolute).toLowerCase()), stat.size, stat.mtimeMs, contentHash, titleFor(target.absolute, extracted.text), extracted.text, extracted.extraction, safeJson(metadata), isoNow(), row.id);
      runtime.db.prepare(`DELETE FROM document_fts WHERE document_id = ?`).run(row.id);
      runtime.db.prepare(`INSERT INTO document_fts (document_id,title,content) VALUES (?,?,?)`).run(row.id, titleFor(target.absolute, extracted.text), extracted.text);
    }
    runtime.db.prepare(`UPDATE proposals SET status = 'applied', applied_at = ? WHERE id = ?`).run(isoNow(), proposalId);
    audit(runtime, { actor, sessionId, operation: "apply_document_proposal", result: "applied", documentId: row.id, details: { proposalId, kind: proposal.operation } });
    hardenDatabaseFiles(runtime.dbPath);
    return { status: "applied", applied: true, document: publicDocument(runtime.db.prepare(`SELECT * FROM documents WHERE id = ?`).get(row.id), runtime) };
  } catch (error) {
    runtime.db.prepare(`UPDATE proposals SET status = 'failed' WHERE id = ?`).run(proposalId);
    audit(runtime, { actor, sessionId, operation: "apply_document_proposal", result: "failed", documentId: row.id, details: { proposalId, reason: "mutation failed" } });
    hardenDatabaseFiles(runtime.dbPath);
    throw error;
  }
}

export function runtimeInfo(runtime) {
  return { cwd: runtime.cwd, dbPath: runtime.dbPath, auditPath: runtime.auditPath, dataDir: runtime.dataDir, notesDir: runtime.notesDir, roots: runtime.roots };
}
