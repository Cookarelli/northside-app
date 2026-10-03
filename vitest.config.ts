import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({test:{include:['tests/**/*.test.ts','packages/**/*.test.ts','apps/**/*.test.ts'],exclude:['**/node_modules/**','**/.next/**','apps/customer/**'],testTimeout:15000},resolve:{alias:Object.fromEntries(['domain','data','shopify','agent-runtime'].map(n=>['@northside/'+n,resolve('packages/'+n+'/src/index.ts')]))}});
