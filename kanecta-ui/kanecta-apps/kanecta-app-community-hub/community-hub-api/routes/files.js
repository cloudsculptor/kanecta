import { Router } from "express";
import { getFileStream } from "../lib/spaces.js";
import { getFileById } from "../repositories/files.js";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /api/files/:id ─────────────────────────────────────────────────────────
// Public byte-serving proxy for uploaded files. Under DATA_BACKEND=kanecta the
// frontend embeds `${KANECTA_FILE_URL_BASE}/${fileId}` (see lib/spacesKanecta.js),
// which points here — community-hub streams the bytes from Kanecta's store so
// kanecta-api never needs to be publicly reachable. Public (no auth) on purpose:
// it replaces the old ACL public-read Spaces URLs that anonymous visitors load
// page/event images from; ids are unguessable UUIDs, same as the old URLs.
// Works in pg mode too (streams from Spaces via the record's storage_key).
router.get("/:id", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid file id" });
  }
  try {
    const file = await getFileById(req.params.id);
    if (!file) return res.status(404).json({ error: "File not found" });

    const { Body, ContentLength } = await getFileStream({
      storageKey: file.storage_key,
      mimeType: file.mime_type,
    });
    res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
    if (ContentLength != null) res.setHeader("Content-Length", ContentLength);
    if (file.name) {
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`
      );
    }
    // A file id's bytes never change (edits upload a new file) — cache hard,
    // like the old public Spaces URLs did.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    Body.pipe(res);
  } catch (err) {
    if (err.code === "NoSuchKey" || err.Code === "NoSuchKey") {
      return res.status(404).json({ error: "File not found" });
    }
    console.error("[files]", err.message);
    res.status(500).json({ error: "Failed to serve file" });
  }
});

export default router;
