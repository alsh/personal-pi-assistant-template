import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs, existsSync, chmodSync, mkdirSync, realpathSync, statSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

const execFileAsync = promisify(execFile);

export const MAX_RESULT_CHARS = 20_000;
export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_FILES = 2_000;
const MAX_ARCHIVE_ENTRIES = 50;
const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".text", ".edm", ".xml", ".json", ".csv", ".tsv", ".html", ".htm", ".log",
]);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ".pdf", ".zip"]);
const IGNORED_DIRECTORY_NAMES = new Set([".git", ".pi", "node_modules", ".cache", "backups", "credentials", "secrets"]);

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
  const heading = content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
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
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      due_date TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS cases_status_idx ON cases(status, due_date);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      case_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_case_idx ON tasks(case_id, status, due_date);
    CREATE TABLE IF NOT EXISTS case_documents (
      case_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      relation TEXT NOT NULL DEFAULT 'evidence',
      note TEXT NOT NULL DEFAULT '',
      linked_at TEXT NOT NULL,
      PRIMARY KEY(case_id, document_id),
      FOREIGN KEY(case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS case_documents_document_idx ON case_documents(document_id);
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

export function loadProjectConfig(cwd) {
  const configPath = path.join(cwd, ".pi", "personal-assistant.json");
  let fileConfig = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Invalid .pi/personal-assistant.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const fixtureRoot = path.join(cwd, "fixtures", "documents");
  const environmentRoots = process.env.PA_DOCUMENT_ROOTS?.split(path.delimiter).map((value) => value.trim()).filter(Boolean);
  const roots = environmentRoots?.length
    ? environmentRoots
    : (Array.isArray(fileConfig.documentRoots) ? fileConfig.documentRoots.filter((value) => typeof value === "string") : (existsSync(fixtureRoot) ? ["fixtures/documents"] : []));
  return {
    documentRoots: roots,
    dataDir: typeof fileConfig.dataDir === "string" ? fileConfig.dataDir : "~/.local/share/personal-assistant",
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
  const roots = [];
  for (const configured of configuredRoots) {
    const absolute = resolveFromCwd(projectCwd, configured);
    try {
      const real = realpathSync(absolute);
      const stat = statSync(real);
      roots.push({ configured, absolute: real, label: rootLabel(projectCwd, real), exists: stat.isDirectory() });
    } catch (error) {
      roots.push({ configured, absolute, label: configured, exists: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const configuredDataDir = dataDirOverride ?? process.env.PA_DATA_DIR ?? config.dataDir;
  const dataDir = resolveFromCwd(projectCwd, configuredDataDir);
  ensurePrivateDirectory(dataDir);
  const privateDocumentsDir = path.join(dataDir, "documents");
  const extractedDir = path.join(dataDir, "extracted");
  ensurePrivateDirectory(privateDocumentsDir);
  ensurePrivateDirectory(extractedDir);
  if (!roots.some((root) => root.absolute === privateDocumentsDir)) {
    roots.push({ configured: "<private-documents>", absolute: privateDocumentsDir, label: "private-documents", exists: true, private: true });
  }
  const dbPath = path.join(dataDir, "documents.sqlite");
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
  runtime.db.prepare(`INSERT INTO audit_events (id,timestamp,actor,session_id,operation,result,document_id,details_json) VALUES (?,?,?,?,?,?,?,?)`)
    .run(`a_${randomUUID()}`, isoNow(), actor, sessionId, operation, result, documentId, safeJson(details));
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
    const caseCounts = runtime.db.prepare(`SELECT status, COUNT(*) AS count FROM cases GROUP BY status`).all();
    const taskCounts = runtime.db.prepare(`SELECT status, COUNT(*) AS count FROM tasks GROUP BY status`).all();
  return {
    dataClass: "C2 document metadata/content",
    storage: "private local SQLite outside the project tree",
    roots: runtime.roots.map((root) => ({ label: root.label, exists: root.exists, status: root.error ? "error" : root.exists ? "ready" : "missing" })),
    documents: Object.fromEntries(counts.map((row) => [row.status, row.count])),
    proposals: Object.fromEntries(proposals.map((row) => [row.status, row.count])),
    cases: Object.fromEntries(caseCounts.map((row) => [row.status, row.count])),
    tasks: Object.fromEntries(taskCounts.map((row) => [row.status, row.count])),
    capabilities: ["read", "search", "index", "propose-local-change", "confirm-local-change", "local-cases", "local-tasks", "document-links"],
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

const CASE_STATUSES = new Set(["open", "waiting", "submitted", "closed", "archived"]);
const TASK_STATUSES = new Set(["open", "in_progress", "waiting", "done", "cancelled"]);
const TASK_PRIORITIES = new Set(["low", "normal", "high"]);
const CASE_DOCUMENT_RELATIONS = new Set(["requirement", "evidence", "submission", "response", "other"]);

function optionalDate(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(text)) throw new Error(`${fieldName} must be YYYY-MM-DD or an ISO date-time`);
  return text;
}

function requiredShortText(value, fieldName, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${fieldName} is required`);
  if (text.length > maxLength) throw new Error(`${fieldName} is too long`);
  return text;
}

function optionalLongText(value, fieldName, maxLength) {
  const text = String(value ?? "").trim();
  if (text.length > maxLength) throw new Error(`${fieldName} is too long`);
  return text;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const normalized = [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (normalized.some((tag) => tag.length > 60)) throw new Error("tag is too long");
  return normalized;
}

function publicCase(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    dueDate: row.due_date,
    tags: JSON.parse(row.tags_json || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

function publicTask(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function getCaseRow(runtime, caseId) {
  const row = runtime.db.prepare(`SELECT * FROM cases WHERE id = ?`).get(caseId);
  if (!row) throw new Error("case not found");
  return row;
}

function getTaskRow(runtime, taskId) {
  const row = runtime.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
  if (!row) throw new Error("task not found");
  return row;
}

export function createCase(runtime, { title, description = "", dueDate, tags = [], actor = "assistant", sessionId = null } = {}) {
  const cleanTitle = requiredShortText(title, "case title", 200);
  const cleanDescription = optionalLongText(description, "case description", 5_000);
  const cleanDueDate = optionalDate(dueDate, "case due date");
  const cleanTags = normalizeTags(tags);
  const now = isoNow();
  const id = `case_${randomUUID()}`;
  runtime.db.prepare(`INSERT INTO cases (id,title,description,status,due_date,tags_json,created_at,updated_at,closed_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, cleanTitle, cleanDescription, "open", cleanDueDate, safeJson(cleanTags), now, now, null);
  audit(runtime, { actor, sessionId, operation: "create_case", result: "ok", details: { caseId: id } });
  hardenDatabaseFiles(runtime.dbPath);
  return publicCase(getCaseRow(runtime, id));
}

export function listCases(runtime, { status, limit = 50, actor = "assistant", sessionId = null } = {}) {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  let rows;
  if (status) {
    if (!CASE_STATUSES.has(status)) throw new Error("unsupported case status");
    rows = runtime.db.prepare(`SELECT * FROM cases WHERE status = ? ORDER BY COALESCE(due_date, '9999-12-31'), updated_at DESC LIMIT ?`).all(status, boundedLimit);
  } else {
    rows = runtime.db.prepare(`SELECT * FROM cases ORDER BY CASE status WHEN 'closed' THEN 1 ELSE 0 END, COALESCE(due_date, '9999-12-31'), updated_at DESC LIMIT ?`).all(boundedLimit);
  }
  const result = rows.map(publicCase);
  audit(runtime, { actor, sessionId, operation: "list_cases", result: "ok", details: { count: result.length } });
  return result;
}

export function updateCase(runtime, { caseId, title, description, status, dueDate, tags, actor = "assistant", sessionId = null } = {}) {
  const current = getCaseRow(runtime, caseId);
  const assignments = [];
  const values = [];
  if (title !== undefined) { assignments.push("title = ?"); values.push(requiredShortText(title, "case title", 200)); }
  if (description !== undefined) { assignments.push("description = ?"); values.push(optionalLongText(description, "case description", 5_000)); }
  if (status !== undefined) { if (!CASE_STATUSES.has(status)) throw new Error("unsupported case status"); assignments.push("status = ?"); values.push(status); }
  if (dueDate !== undefined) { assignments.push("due_date = ?"); values.push(optionalDate(dueDate, "case due date")); }
  if (tags !== undefined) { assignments.push("tags_json = ?"); values.push(safeJson(normalizeTags(tags))); }
  if (assignments.length === 0) throw new Error("no case changes supplied");
  const now = isoNow();
  assignments.push("updated_at = ?"); values.push(now);
  if (status === "closed") { assignments.push("closed_at = ?"); values.push(now); } else if (status !== undefined) { assignments.push("closed_at = ?"); values.push(null); }
  values.push(caseId);
  runtime.db.prepare(`UPDATE cases SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
  audit(runtime, { actor, sessionId, operation: "update_case", result: "ok", details: { caseId, fromStatus: current.status, toStatus: status ?? current.status } });
  hardenDatabaseFiles(runtime.dbPath);
  return publicCase(getCaseRow(runtime, caseId));
}

export function createTask(runtime, { caseId = null, title, description = "", dueDate, priority = "normal", actor = "assistant", sessionId = null } = {}) {
  const cleanTitle = requiredShortText(title, "task title", 240);
  const cleanDescription = optionalLongText(description, "task description", 5_000);
  if (caseId !== null) getCaseRow(runtime, caseId);
  if (!TASK_PRIORITIES.has(priority)) throw new Error("unsupported task priority");
  const cleanDueDate = optionalDate(dueDate, "task due date");
  const now = isoNow();
  const id = `task_${randomUUID()}`;
  runtime.db.prepare(`INSERT INTO tasks (id,case_id,title,description,status,priority,due_date,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, caseId, cleanTitle, cleanDescription, "open", priority, cleanDueDate, now, now, null);
  audit(runtime, { actor, sessionId, operation: "create_task", result: "ok", details: { taskId: id, caseId } });
  hardenDatabaseFiles(runtime.dbPath);
  return publicTask(getTaskRow(runtime, id));
}

export function listTasks(runtime, { caseId, status, limit = 100, actor = "assistant", sessionId = null } = {}) {
  const boundedLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  const clauses = [];
  const values = [];
  if (caseId !== undefined && caseId !== null) { getCaseRow(runtime, caseId); clauses.push("case_id = ?"); values.push(caseId); }
  if (status) { if (!TASK_STATUSES.has(status)) throw new Error("unsupported task status"); clauses.push("status = ?"); values.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(boundedLimit);
  const result = runtime.db.prepare(`SELECT * FROM tasks ${where} ORDER BY CASE status WHEN 'done' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END, COALESCE(due_date, '9999-12-31'), updated_at DESC LIMIT ?`).all(...values).map(publicTask);
  audit(runtime, { actor, sessionId, operation: "list_tasks", result: "ok", details: { count: result.length, caseId: caseId ?? null } });
  return result;
}

export function updateTask(runtime, { taskId, title, description, status, dueDate, priority, actor = "assistant", sessionId = null } = {}) {
  const current = getTaskRow(runtime, taskId);
  const assignments = [];
  const values = [];
  if (title !== undefined) { assignments.push("title = ?"); values.push(requiredShortText(title, "task title", 240)); }
  if (description !== undefined) { assignments.push("description = ?"); values.push(optionalLongText(description, "task description", 5_000)); }
  if (status !== undefined) { if (!TASK_STATUSES.has(status)) throw new Error("unsupported task status"); assignments.push("status = ?"); values.push(status); }
  if (dueDate !== undefined) { assignments.push("due_date = ?"); values.push(optionalDate(dueDate, "task due date")); }
  if (priority !== undefined) { if (!TASK_PRIORITIES.has(priority)) throw new Error("unsupported task priority"); assignments.push("priority = ?"); values.push(priority); }
  if (assignments.length === 0) throw new Error("no task changes supplied");
  const now = isoNow();
  assignments.push("updated_at = ?"); values.push(now);
  if (status === "done") { assignments.push("completed_at = ?"); values.push(now); } else if (status !== undefined) { assignments.push("completed_at = ?"); values.push(null); }
  values.push(taskId);
  runtime.db.prepare(`UPDATE tasks SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
  audit(runtime, { actor, sessionId, operation: "update_task", result: "ok", details: { taskId, fromStatus: current.status, toStatus: status ?? current.status } });
  hardenDatabaseFiles(runtime.dbPath);
  return publicTask(getTaskRow(runtime, taskId));
}

export function linkDocumentToCase(runtime, { caseId, documentId, relation = "evidence", note = "", actor = "assistant", sessionId = null } = {}) {
  getCaseRow(runtime, caseId);
  const document = runtime.db.prepare(`SELECT * FROM documents WHERE id = ? AND status = 'active'`).get(documentId);
  if (!document) throw new Error("active document not found");
  if (!CASE_DOCUMENT_RELATIONS.has(relation)) throw new Error("unsupported document relation");
  const cleanNote = optionalLongText(note, "link note", 2_000);
  runtime.db.prepare(`INSERT INTO case_documents (case_id,document_id,relation,note,linked_at) VALUES (?,?,?,?,?) ON CONFLICT(case_id,document_id) DO UPDATE SET relation=excluded.relation,note=excluded.note,linked_at=excluded.linked_at`)
    .run(caseId, documentId, relation, cleanNote, isoNow());
  audit(runtime, { actor, sessionId, operation: "link_document_to_case", result: "ok", documentId, details: { caseId, relation } });
  hardenDatabaseFiles(runtime.dbPath);
  return { caseId, document: publicDocument(document, runtime), relation, note: cleanNote };
}

export function getCaseSummary(runtime, caseId, { actor = "assistant", sessionId = null } = {}) {
  const current = getCaseRow(runtime, caseId);
  const tasks = runtime.db.prepare(`SELECT * FROM tasks WHERE case_id = ? ORDER BY CASE status WHEN 'done' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END, COALESCE(due_date, '9999-12-31'), updated_at DESC`).all(caseId).map(publicTask);
  const documents = runtime.db.prepare(`SELECT d.*, cd.relation, cd.note, cd.linked_at FROM case_documents cd JOIN documents d ON d.id = cd.document_id WHERE cd.case_id = ? AND d.status != 'missing' ORDER BY cd.linked_at DESC`).all(caseId).map((row) => ({ ...publicDocument(row, runtime), relation: row.relation, note: row.note, linkedAt: row.linked_at }));
  const result = { case: publicCase(current), tasks, documents };
  audit(runtime, { actor, sessionId, operation: "get_case_summary", result: "ok", details: { caseId, taskCount: tasks.length, documentCount: documents.length } });
  return result;
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
  return { cwd: runtime.cwd, dbPath: runtime.dbPath, dataDir: runtime.dataDir, roots: runtime.roots };
}
