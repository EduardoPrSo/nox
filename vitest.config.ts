import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageNames = [
  'agent',
  'ai',
  'audit',
  'automations',
  'confirmations',
  'database',
  'identity',
  'memory',
  'permissions',
  'shared',
  'tools',
  'usage',
  'voice',
];
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      packageNames.map((name) => [
        `@nox/${name}`,
        fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  test: { include: ['tests/**/*.test.ts'], globals: true },
});
