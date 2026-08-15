import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageNames = [
  'agent',
  'ai',
  'audit',
  'automations',
  'confirmations',
  'database',
  'memory',
  'permissions',
  'shared',
  'tools',
];
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      packageNames.map((name) => [
        `@jarvis/${name}`,
        fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  test: { include: ['tests/**/*.test.ts'], globals: true },
});
