import { Router } from "express";
import { randomUUID } from "crypto";
import { createWriteStream, createReadStream, unlink, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const archiver = require("archiver");
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getFileStream } from "../lib/spaces.js";

const router = Router();
const requireTeam = requireRole("team", "moderator", "admin");
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const PUBLIC_URL = process.env.SPACES_PUBLIC_URL;
const SITE_URL = "https://featherston.co.nz";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRY_MS = 5 * 60 * 1000;

const pending = new Map();

// ── Lexical JSON → Markdown ────────────────────────────────────────────────────

function serializeNode(node) {
  if (!node) return "";
  switch (node.type) {
    case "root":
      return (node.children || []).map(serializeNode).join("\n\n");
    case "paragraph":
      return (node.children || []).map(serializeNode).join("");
    case "heading": {
      const level = parseInt((node.tag || "h1").replace("h", ""), 10);
      const hashes = "#".repeat(Math.min(Math.max(level, 1), 6));
      return `${hashes} ${(node.children || []).map(serializeNode).join("")}`;
    }
    case "text": {
      let t = node.text || "";
      const fmt = node.format || 0;
      if (fmt & 16) return `\`${t}\``;
      if (fmt & 1) t = `**${t}**`;
      if (fmt & 2) t = `*${t}*`;
      if (fmt & 4) t = `~~${t}~~`;
      return t;
    }
    case "linebreak":
      return "\n";
    case "link": {
      const text = (node.children || []).map(serializeNode).join("");
      return `[${text}](${node.url || ""})`;
    }
    case "image":
      return `![${node.altText || ""}](${node.src || ""})`;
    case "list": {
      const ordered = node.listType === "number";
      return (node.children || []).map((item, i) => {
        const prefix = ordered ? `${i + 1}. ` : "- ";
        return `${prefix}${serializeNode(item)}`;
      }).join("\n");
    }
    case "listitem":
      return (node.children || []).map(serializeNode).join("");
    case "quote":
      return (node.children || []).map(serializeNode).join("").split("\n").map((l) => `> ${l}`).join("\n");
    case "code": {
      const lang = node.language || "";
      const lines = (node.children || []).map(serializeNode).join("");
      return `\`\`\`${lang}\n${lines}\n\`\`\``;
    }
    case "horizontalrule":
      return "---";
    default:
      if (Array.isArray(node.children)) return node.children.map(serializeNode).join("");
      return "";
  }
}

function lexicalToMarkdown(contentJson) {
  if (!contentJson?.root) return "";
  return serializeNode(contentJson.root).trim();
}

// ── Extract image references from Lexical JSON ────────────────────────────────

function extractImageRefs(contentJson) {
  const refs = [];
  if (!PUBLIC_URL || !contentJson?.root) return refs;
  const prefix = PUBLIC_URL + "/";

  function walk(node) {
    if (!node) return;
    if (node.type === "image" && typeof node.src === "string" && node.src.startsWith(prefix)) {
      const storageKey = node.src.slice(prefix.length);
      const uuid = storageKey.split("/")[2];
      if (uuid && UUID_RE.test(uuid)) {
        refs.push({ uuid, src: node.src, storageKey });
      }
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }

  walk(contentJson.root);
  return refs;
}

// ── POST /api/download/prepare ─────────────────────────────────────────────────

router.post("/prepare", requireAuth, requireTeam, wrap(async (req, res) => {
  const { rows: pages } = await pool.query(
    `SELECT slug, title, content_json FROM pages
     WHERE public = TRUE AND deleted_at IS NULL
     ORDER BY title`
  );

  // Collect unique image UUIDs and per-page image maps
  const allUUIDs = new Set();
  const pageImageRefs = new Map(); // slug -> [{ uuid, src, storageKey }]

  for (const page of pages) {
    const refs = extractImageRefs(page.content_json);
    pageImageRefs.set(page.slug, refs);
    for (const ref of refs) allUUIDs.add(ref.uuid);
  }

  // Look up original filenames from the files table
  const uuidToFile = new Map();
  if (allUUIDs.size > 0) {
    const { rows: files } = await pool.query(
      `SELECT id, name, storage_key FROM files
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [[...allUUIDs]]
    );
    for (const f of files) {
      uuidToFile.set(f.id, { name: f.name, storageKey: f.storage_key });
    }
  }

  // Build zip
  const token = randomUUID();
  const zipPath = join(tmpdir(), `featherston-${token}.zip`);
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { zlib: { level: 6 } });

  const closePromise = new Promise((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);

  // Add page markdown files
  for (const page of pages) {
    const refs = pageImageRefs.get(page.slug) || [];
    let markdown = lexicalToMarkdown(page.content_json);

    // Rewrite image src URLs to local relative filenames
    for (const ref of refs) {
      const fileInfo = uuidToFile.get(ref.uuid);
      if (fileInfo) {
        markdown = markdown.split(ref.src).join(`./${fileInfo.name}`);
      }
    }

    const pageUrl = `${SITE_URL}/resilience/pages/${page.slug}`;
    const fullMarkdown = `<!-- ${pageUrl} -->\n\n# ${page.title}\n\n${markdown}`;
    archive.append(fullMarkdown, { name: `pages/${page.slug}/index.md` });
  }

  // Add images (download from Spaces and stream into zip)
  for (const page of pages) {
    const refs = pageImageRefs.get(page.slug) || [];
    const addedToThisPage = new Set();
    for (const ref of refs) {
      const fileInfo = uuidToFile.get(ref.uuid);
      if (!fileInfo || addedToThisPage.has(fileInfo.name)) continue;
      addedToThisPage.add(fileInfo.name);
      try {
        const response = await getFileStream({ storageKey: ref.storageKey });
        archive.append(response.Body, { name: `pages/${page.slug}/${fileInfo.name}` });
      } catch {
        // Skip images that can't be fetched; markdown ref keeps original URL as fallback
      }
    }
  }

  // Add root index.md
  const date = new Date().toISOString().slice(0, 10);
  const indexLines = [
    `# featherston.co.nz — Site Download`,
    ``,
    `Generated: ${date}`,
    ``,
    `## Public Pages`,
    ``,
    ...pages.map((p) => `- [${p.title}](pages/${p.slug}/index.md)`),
  ];
  archive.append(indexLines.join("\n"), { name: "index.md" });

  archive.finalize();
  await closePromise;

  const { size } = statSync(zipPath);

  pending.set(token, { zipPath, size });
  setTimeout(() => {
    unlink(zipPath, () => {});
    pending.delete(token);
  }, EXPIRY_MS);

  res.json({ token, size });
}));

// ── GET /api/download/:token ───────────────────────────────────────────────────

router.get("/:token", requireAuth, requireTeam, (req, res) => {
  const entry = pending.get(req.params.token);
  if (!entry) return res.status(404).json({ error: "Download not found or expired" });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="featherston-pages.zip"');
  res.setHeader("Content-Length", entry.size);
  createReadStream(entry.zipPath).pipe(res);
});

// ── Error handler ─────────────────────────────────────────────────────────────

router.use((err, req, res, _next) => {
  console.error("[download]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export default router;
