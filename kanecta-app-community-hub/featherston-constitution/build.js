const Asciidoctor = require('@asciidoctor/core')();
const { marked } = require('marked');
const fs = require('fs');
const path = require('path');

marked.setOptions({ gfm: true });

// ── Clause hyperlink pre-processor ───────────────────────────────────────
// Runs on the raw .adoc source before Asciidoctor sees it.
// Adds [#clause-N] anchors to section headers and converts "clause N"
// references to AsciiDoc xrefs. The source file stays plain text;
// links are always up to date on every build.

const VALID_SUBS = [
  '3.1','3.2',
  '7.1','7.2','7.3',
  '9.1','9.2','9.3','9.4','9.5','9.6',
  '17.1','17.2',
  '18.1','18.2','18.3','18.4','18.5',
];

function addHyperlinks(text) {
  // 1. Anchors on main section headers (=== N. Title)
  text = text.replace(/^(=== )(\d+)\./gm,
    (_, p, n) => `[#clause-${n}]\n${p}${n}.`);

  // 2. Anchors on sub-section headers (==== N.M Title) — real sections only
  VALID_SUBS.forEach(sub => {
    const [n, m] = sub.split('.');
    text = text.replace(
      new RegExp(`^(==== )${n}\\.${m}(?= )`, 'gm'),
      `[#clause-${n}-${m}]\n$1${n}.${m}`);
  });

  // 3. Inline sub-clause xrefs — do before main so "9.5" isn't split into "9" then ".5"
  VALID_SUBS.forEach(sub => {
    const [n, m] = sub.split('.');
    text = text.replace(
      new RegExp(`([Cc]lause[s]? )${n}\\.${m}(?!\\d)`, 'g'),
      (_, prefix) => `<<clause-${n}-${m},${prefix}${n}.${m}>>`);
  });

  // 4. Inline main clause xrefs (iterate high→low to avoid partial matches)
  for (let i = 32; i >= 1; i--) {
    text = text.replace(
      // Skip if followed by: digit, dot, –, or already inside an xref (>>)
      new RegExp(`([Cc]lause[s]? )${i}(?![\\d.–>])`, 'g'),
      (_, prefix) => `<<clause-${i},${prefix}${i}>>`);
  }

  return text;
}

// ── Constitution build ────────────────────────────────────────────────────
function buildConstitution() {
  const src = fs.readFileSync(path.resolve(__dirname, 'constitution.adoc'), 'utf8');
  const processed = addHyperlinks(src);
  const html = Asciidoctor.convert(processed, {
    safe: 'unsafe',
    standalone: true,
    base_dir: __dirname,
    attributes: { 'outfilesuffix': '.html' },
  });
  fs.writeFileSync(path.resolve(__dirname, 'index.html'), html);
  console.log('Built → index.html');
}

// ── Work plan build ───────────────────────────────────────────────────────
function buildWorkplan() {
  const md = fs.readFileSync(path.resolve(__dirname, 'WORKPLAN.md'), 'utf8');
  const body = marked.parse(md);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Work Plan — Featherston Inc</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 40px auto; padding: 0 24px; color: #24292e; line-height: 1.6; }
  h1 { border-bottom: 2px solid #e1e4e8; padding-bottom: 12px; }
  h2 { border-bottom: 1px solid #e1e4e8; padding-bottom: 8px; margin-top: 32px; }
  h3 { margin-top: 24px; }
  input[type="checkbox"] { width: 16px; height: 16px; margin-right: 6px; accent-color: #2ea44f; cursor: pointer; }
  li { margin: 6px 0; }
  ul { padding-left: 20px; }
  code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  hr { border: none; border-top: 1px solid #e1e4e8; margin: 32px 0; }
  blockquote { border-left: 4px solid #e1e4e8; margin: 0; padding: 0 16px; color: #6a737d; }
  a { color: #0366d6; }
  .back { font-size: 0.9em; margin-bottom: 24px; display: block; }
</style>
</head>
<body>
<a class="back" href="index.html">← Constitution</a>
${body}
<script>
  document.querySelectorAll('input[type="checkbox"]').forEach((cb, i) => {
    const key = 'wp-cb-' + i;
    cb.checked = localStorage.getItem(key) === '1';
    cb.addEventListener('change', () => localStorage.setItem(key, cb.checked ? '1' : '0'));
  });
</script>
</body>
</html>`;
  fs.writeFileSync(path.resolve(__dirname, 'workplan.html'), html);
  console.log('Built → workplan.html');
}

buildConstitution();
buildWorkplan();

module.exports = { buildConstitution, buildWorkplan };
