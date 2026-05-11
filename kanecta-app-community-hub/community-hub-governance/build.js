const Asciidoctor = require('@asciidoctor/core')();
const AsciidoctorRevealjs = require('@asciidoctor/reveal.js');
const fs = require('fs');
const path = require('path');

AsciidoctorRevealjs.register();

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
  const src = fs.readFileSync(path.resolve(__dirname, 'constitution/constitution.adoc'), 'utf8');
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

// ── Slides build ──────────────────────────────────────────────────────────
function buildSlides() {
  const src = fs.readFileSync(path.resolve(__dirname, 'slides/slides.adoc'), 'utf8');
  const html = Asciidoctor.convert(src, {
    backend: 'revealjs',
    safe: 'unsafe',
    standalone: true,
    base_dir: path.resolve(__dirname, 'slides'),
    attributes: {
      revealjsdir: 'https://cdn.jsdelivr.net/npm/reveal.js@5',
      revealjs_theme: 'white',
      revealjs_slideNumber: 'true',
      revealjs_history: 'true',
      revealjs_transition: 'slide',
    },
  });
  fs.writeFileSync(path.resolve(__dirname, 'slides.html'), html);
  console.log('Built → slides.html');
}

buildConstitution();
buildSlides();

module.exports = { buildConstitution, buildSlides };
