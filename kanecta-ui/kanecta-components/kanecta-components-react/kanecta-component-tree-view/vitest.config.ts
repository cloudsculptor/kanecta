import { defineConfig } from 'vitest/config';

// The package's tests were orphaned when TreeView was extracted from
// kanecta-app-studio (whose vitest include only covers its own src/) — this
// config makes `npm test` here collect them again. No @vitejs/plugin-react:
// esbuild's automatic JSX transform (from tsconfig jsx: react-jsx) suffices
// for tests, and the plugin isn't resolvable from this package.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
