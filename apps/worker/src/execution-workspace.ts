import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { safeEnvironment } from './process';

export interface ExportManifest {
  version: 1; sourceCommit: string; executable: false; status: 'prepared-only';
  included: { path: string; sha256: string; bytes: number; mode: string }[];
  excluded: { path: string; reason: string }[];
  limitation: string;
}
function excluded(path: string): string | undefined {
  const parts = path.toLowerCase().split('/');
  if (parts.some(p => ['.git', '.codex', '.agents', '.runtime', '.ssh', '.aws', '.config', 'node_modules'].includes(p))) return 'Private state, inherited tooling, or dependencies';
  if (parts.some(p => p.startsWith('.env') || ['.npmrc', '.netrc', '.pypirc', 'auth.json', 'credentials.json'].includes(p) || /(?:credential|secret|token)s?\.(?:json|txt|ya?ml)$/.test(p) || /\.(?:key|pem|p12|pfx|sqlite|sqlite3|db)$/.test(p))) return 'Credential/configuration/data filename';
}
/** Operator preparation only. This incomplete export is never accepted as successful verification. */
export async function prepareExecutionWorkspace(repo: string, commit: string, exportRoot: string, signal?: AbortSignal) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('An exact source commit is required');
  const git = (args: string[], maxBuffer: number) => new Promise<Buffer>((resolve, reject) => {
    execFile('/usr/bin/git', args, { cwd: repo, env: safeEnvironment(), encoding: 'buffer', maxBuffer, timeout: 60_000, signal }, (error, stdout) => {
      if (error) reject(new Error('Cannot export the selected committed source within the preparation budget'));
      else resolve(stdout);
    });
  });
  if ((await git(['cat-file', '-t', commit], 100)).toString('utf8').trim() !== 'commit') throw new Error('The source object must be a commit');
  const tree = (await git(['ls-tree', '-rz', '--full-tree', commit], 2_000_000)).toString('utf8');
  const entries: { mode: string; hash: string; path: string }[] = []; const names = new Map<string,string>();
  for (const record of tree.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/s.exec(record);
    if (!match) throw new Error('Execution export rejects symlinks, submodules, and unsupported objects');
    const [, mode, hash, path] = match;
    if (/[\\\x00-\x1f\x7f]/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Execution export contains an unsafe filename');
    const parts = path.split('/');
    for(let i=1;i<=parts.length;i++) {const prefix=parts.slice(0,i).join('/');const canonical=prefix.normalize('NFC').toLowerCase();if(names.has(canonical)&&names.get(canonical)!==prefix)throw new Error('Execution export contains case-colliding filenames');names.set(canonical,prefix);}
    entries.push({ mode, hash, path });
  }
  if (!entries.length || entries.length > 10_000) throw new Error('Execution export file count is outside the preparation budget');
  await mkdir(exportRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(exportRoot, 'execution-')); const source = join(directory, 'source'); await mkdir(source, { mode: 0o700 });
  const manifest: ExportManifest = { version: 1, sourceCommit: commit, executable: false, status: 'prepared-only', included: [], excluded: [], limitation: 'Sanitized committed-source subset only. No dependencies, credentials, Git metadata, or executable sandbox are provisioned. Omitted inputs and committed source need independent review before any verifier can use this artifact.' };
  let bytes = 0;
  for (const entry of entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    signal?.throwIfAborted(); const reason = excluded(entry.path);
    if (reason) { manifest.excluded.push({ path: entry.path, reason }); continue; }
    const content = await git(['cat-file', 'blob', entry.hash], 16_000_000); bytes += content.length;
    if (bytes > 128_000_000) throw new Error('Execution export exceeds the preparation byte budget');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|nsw_[A-Za-z0-9_-]{43}|shpat_[a-fA-F0-9]{24,}|sk-(?:proj-)?[A-Za-z0-9_-]{40,}/.test(content.toString('utf8'))) throw new Error('Execution export detected a credential-like value; inspect source privately');
    const destination = join(source, entry.path); await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, content, { flag: 'wx', mode: entry.mode === '100755' ? 0o700 : 0o600 });
    manifest.included.push({ path: entry.path, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length, mode: entry.mode });
  }
  const manifestPath = join(directory, 'manifest.json'); await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { directory, source, manifestPath, manifest };
}
