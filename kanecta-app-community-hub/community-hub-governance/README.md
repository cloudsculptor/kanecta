# Featherston Inc — Constitution

**[View the constitution in your browser](https://cloudsculptor.github.io/featherston-constitution/)**

Served via GitHub Pages. Enable it at **Settings → Pages → Branch: main, folder: / (root)** if not already live.

The source of truth is [constitution.adoc](constitution.adoc) — a human-readable AsciiDoc file.
The rendered [index.html](index.html) is committed to the repo root and served directly by GitHub Pages.

---

## Local development

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later

### First-time setup

```bash
npm install
```

### Live preview (recommended)

```bash
npm run dev
```

This will:
1. Build `constitution.adoc` → `index.html` immediately
2. Open the rendered constitution in your browser
3. Watch for changes — every time you save `constitution.adoc` the page reloads automatically, no manual refresh needed

### One-off build

```bash
npm run build
```

Rebuilds `index.html` from `constitution.adoc` without starting a server.

---

## Editing the constitution

Edit [constitution.adoc](constitution.adoc) in any text editor. Run `npm run dev` alongside for instant feedback, or `npm run build` after editing to refresh the committed HTML before pushing.

The format is [AsciiDoc](https://asciidoctor.org/) — processed by the official [Asciidoctor.js](https://docs.asciidoctor.org/asciidoctor.js/latest/) library.
