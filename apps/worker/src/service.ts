import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeEnvironment } from './process';
import { readJson, saveJson } from './storage';

export interface WorkerHealth {
  version: 1; pid: number; mode: 'simulated' | 'codex';
  status: 'starting' | 'online' | 'degraded' | 'blocked' | 'stopping' | 'stopped';
  startedAt: number; updatedAt: number; lastPollAt: number | null;
  activeJobs: number; consecutiveFailures: number; pollMs: number; reason?: string;
  effectivePollMs?: number;
}
/** Connection pacing only. Leases, job attempts, and retry eligibility are unaffected. */
export function reconnectDelayMs(basePollMs: number, consecutiveFailures: number): number {
  if (!Number.isInteger(basePollMs) || basePollMs < 1000 || basePollMs > 60_000 || !Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 0) throw new Error('Invalid reconnect delay input');
  return Math.min(60_000, basePollMs * 2 ** Math.min(16, Math.max(0, consecutiveFailures - 1)));
}
export async function writeHealth(root: string, health: WorkerHealth): Promise<void> {
  await saveJson(join(root, 'health.json'), health);
}
export async function readHealth(root: string) {
  const health = await readJson<WorkerHealth>(join(root, 'health.json'));
  if (!health) return { healthy: false, reason: 'No worker health report', health: null };
  let alive = false;
  if (Number.isSafeInteger(health.pid) && health.pid > 0) {
    try { process.kill(health.pid, 0); alive = true; } catch { /* Missing/inaccessible process is unhealthy. */ }
  }
  const fresh = Date.now() - health.updatedAt < Math.max(30_000, Math.min(180_000, (health.effectivePollMs ?? health.pollMs) * 3));
  return { healthy: alive && fresh && health.status === 'online', alive, fresh, health };
}

/** OS-held lock survives contention and releases on coordinator death; its inode is never unlinked. */
export async function acquireCoordinatorLock(root: string): Promise<{ release: () => Promise<void>; signal: AbortSignal }> {
  if (process.platform !== 'darwin') throw new Error('The service lock requires macOS lockf');
  const legacy = join(root, 'coordinator.lock');
  const legacyInfo = await lstat(legacy).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
  if (legacyInfo) {
    if (!legacyInfo.isDirectory() || legacyInfo.isSymbolicLink()) throw new Error('Inspect the legacy coordinator lock before starting');
    const pid = Number(await readFile(join(legacy, 'pid'), 'utf8').catch(() => 0));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Legacy worker lock has no valid owner; inspect state before starting');
    try { process.kill(pid, 0); throw new Error('Another worker process owns this state directory'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
    // A stale legacy marker is preserved. The new OS lock is independent of marker cleanup.
  }
  const path = join(root, 'coordinator.flock');
  const file = await open(path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); await file.close();
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid?.()) throw new Error('Coordinator lock must be a private regular file owned by this account');
  const child = spawn('/usr/bin/lockf', ['-k', '-t', '0', path, process.execPath, '-e', 'process.stdout.write("LOCKED\\n");process.stdin.resume();'], {
    cwd: root, env: safeEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], shell: false,
  });
  let released = false; const loss = new AbortController();
  const closed = new Promise<void>(resolve => child.once('close', () => { if (!released) loss.abort(); resolve(); }));
  await new Promise<void>((resolve, reject) => {
    let settled = false; let output = '';
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); if(error) reject(error); else resolve(); };
    const timer = setTimeout(() => { child.stdin.end(); child.kill('SIGTERM'); finish(new Error('Coordinator lock acquisition timed out')); }, 5000);
    child.once('error', e => finish(e));
    child.once('close', () => finish(new Error('Another worker process owns this state directory, or the OS lock is unavailable')));
    child.stdout.on('data', data => { output += data.toString(); if (output === 'LOCKED\n') finish(); });
    child.stderr.resume();
  });
  return { signal: loss.signal, release: async () => { released = true; child.stdin.end(); await closed; } };
}
