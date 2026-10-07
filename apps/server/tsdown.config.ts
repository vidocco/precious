import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Workspace packages ship TypeScript source, so bundle them into the server build.
  deps: { alwaysBundle: [/^@precious\//] },
});
