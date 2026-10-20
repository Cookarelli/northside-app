import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({resolve:{alias:{'@northside/data':resolve('packages/data/src/index.ts'),'@northside/agent-runtime':resolve('packages/agent-runtime/src/index.ts')}},test:{include:['tests/worker*.test.ts']}});
