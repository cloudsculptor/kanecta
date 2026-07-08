/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "fs";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'module';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

// ── AsciiDoc plugin — remove this block to drop constitution rendering ───────
const VALID_SUBS = ['3.1','3.2','7.1','7.2','7.3','9.1','9.2','9.3','9.4','9.5','9.6','17.1','17.2','18.1','18.2','18.3','18.4','18.5'];
function addHyperlinks(text: string): string {
  text = text.replace(/^(=== )(\d+)\./gm, (_, p, n) => `[#clause-${n}]\n${p}${n}.`);
  VALID_SUBS.forEach(sub => {
    const [n, m] = sub.split('.');
    text = text.replace(new RegExp(`^(==== )${n}\\.${m}(?= )`, 'gm'), `[#clause-${n}-${m}]\n$1${n}.${m}`);
  });
  VALID_SUBS.forEach(sub => {
    const [n, m] = sub.split('.');
    text = text.replace(new RegExp(`([Cc]lause[s]? )${n}\\.${m}(?!\\d)`, 'g'), (_, prefix) => `<<clause-${n}-${m},${prefix}${n}.${m}>>`);
  });
  for (let i = 32; i >= 1; i--) {
    text = text.replace(new RegExp(`([Cc]lause[s]? )${i}(?![\\d.–>])`, 'g'), (_, prefix) => `<<clause-${i},${prefix}${i}>>`);
  }
  return text;
}
function asciidocPlugin(): Plugin {
  return {
    name: 'asciidoc',
    transform(code, id) {
      if (!id.endsWith('.adoc')) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Asciidoctor = (_require('@asciidoctor/core') as any)();
      const html: string = Asciidoctor.convert(addHyperlinks(code), {
        safe: 'unsafe',
        standalone: false,
        attributes: { outfilesuffix: '.html' },
      });
      return `export default ${JSON.stringify(html)}`;
    },
  };
}
// ── End AsciiDoc plugin ───────────────────────────────────────────────────────

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  server: {
    fs: { allow: [path.resolve(dirname, '..')] },
  },
  plugins: [react(), asciidocPlugin(), {
    name: "copy-index-to-404",
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(dirname, 'dist');
      copyFileSync(path.join(outDir, 'index.html'), path.join(outDir, '404.html'));
    }
  }],
  test: {
    projects: [{
      extends: true,
      plugins: [
      // The plugin will run tests for the stories defined in your Storybook config
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      test: {
        name: 'storybook',
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          instances: [{
            browser: 'chromium'
          }]
        }
      }
    }, {
      // Plain Node unit tests for pure functions (dates, mention parsing, etc.).
      // No browser — fast and deterministic. Files: src/**/*.test.ts(x).
      extends: true,
      test: {
        name: 'unit',
        environment: 'node',
        include: ['src/**/*.test.{ts,tsx}'],
      },
    }]
  }
});