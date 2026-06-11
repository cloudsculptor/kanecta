# Item File Structure Notes

## Current state

Each item folder can contain multiple files:

```
k/data/ab/cd/<uuid>/
  metadata.json      ← lightweight index fields
  function.json      ← extended content (functions)
  object.json        ← extended content (objects)
```

Loading a full item requires two file reads — `metadata.json` then the extended file if present.

---

## Merging into one file

With SQLite as the index layer, the reason for separating metadata from payload goes away — SQLite handles the lightweight queryable fields. The file only gets read when you need the full item, so you want everything in one go.

**Proposed structure:**

```
k/data/ab/cd/<uuid>/
  item.json          ← everything: metadata + payload under a "payload" key
  attachment.pdf     ← freeform attachments, unchanged
```

One read per item, always. Two small files costs 2× the syscall overhead + 2× the data. One slightly bigger file costs 1× the syscall overhead + 1× the data. Both files are almost certainly under 4KB anyway (one OS page read each), so you're paying double the syscall cost to read the same amount of data off disk.

Renaming to `item.json` signals it's the whole item, not just a header.

---

## Sidecar files for large content

Keep the escape hatch for genuinely large values. If a field exceeds a threshold (e.g. 64KB), spill it to a sidecar file and leave a pointer in `item.json`:

```json
{
  "title": "My document",
  "payload": {
    "body": { "$ref": "body.md" }
  }
}
```

```
k/data/ab/cd/<uuid>/
  item.json
  body.md            ← spilled large field
```

This is the same pattern Postgres uses internally — **TOAST** (The Oversized Attribute Storage Technique). Values under ~2KB live inline in the row; larger values are compressed and stored in a separate TOAST table, with a pointer left in the row. You don't think about it, it just happens. The explicit sidecar file is the filesystem equivalent.

---

## What goes in a sidecar vs what stays in JSON

The trigger should be **content type**, not just size:

| Content | Where |
|---|---|
| Structured data (fields, metadata) | `item.json` — JSON is good at this |
| Long freeform text (markdown, prose) | `body.md` — plain file, no escaping |
| Code | `code.js` / `code.py` — plain file, opens in editor |
| Large binary | Attachment file, always |

`item.json` should only ever contain things JSON is actually good at.

---

## Why JSON escaping matters for large strings

Storing long strings directly in JSON has real costs:

- **Size bloat** — newlines, quotes, backslashes, and unicode all get escaped. A 10KB markdown document might become 11–12KB serialised.
- **Parse cost** — every backslash requires the parser to look ahead. A document with thousands of escaped newlines is meaningfully slower to parse than the same content as a plain file.
- **Human readability** — a multi-page document collapsed into a single escaped JSON string is unpleasant to read or edit by hand, and diffs poorly in git.

Plain sidecar files have none of these problems — no escaping, no bloat, open directly in any editor, diff cleanly.

---

## Summary

- Merge `metadata.json` + `function.json` / `object.json` into a single `item.json` with a `payload` key
- Keep sidecar files as an escape hatch for large or freeform content, referenced by pointer
- Use content type (not just size) to decide what goes in the sidecar
- `item.json` stays lean and structured; the filesystem handles the rest
