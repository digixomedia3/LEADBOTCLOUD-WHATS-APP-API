import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Same "@/..." alias as tsconfig, so tests can import app code the way the app does.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Next compiles JSX with the automatic runtime; match it so .tsx files render in tests without importing React.
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node' },
});
