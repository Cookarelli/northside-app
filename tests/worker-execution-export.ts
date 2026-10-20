import { resolve } from 'node:path';
import { prepareExecutionWorkspace } from '../apps/worker/src/execution-workspace';
const [repo, commit, destination] = process.argv.slice(2);
if (!repo || !commit || !destination) throw new Error('Usage: node --import tsx tests/worker-execution-export.ts repository exact-commit export-directory');
const result = await prepareExecutionWorkspace(resolve(repo), commit, resolve(destination));
console.log(JSON.stringify({ status: result.manifest.status, executable: false, sourceCommit: commit, includedFiles: result.manifest.included.length, excludedFiles: result.manifest.excluded.length, manifest: result.manifestPath }, null, 2));
