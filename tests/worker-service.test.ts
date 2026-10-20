import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireCoordinatorLock, readHealth, reconnectDelayMs, writeHealth } from '../apps/worker/src/service';
import { renderLaunchAgent, validateLaunchEnvironment } from '../scripts/launchd-config';
import { prepareExecutionWorkspace } from '../apps/worker/src/execution-workspace';
import { safeEnvironment } from '../apps/worker/src/process';
import { HttpTransport } from '../apps/worker/src/runner';
import { loadConfig } from '../apps/worker/src/config';

const roots: string[] = []; const children: ChildProcess[] = [];
async function temp() { const p = await realpath(await mkdtemp(join(tmpdir(), 'northside-service-test-'))); roots.push(p); return p; }
afterEach(async () => { vi.unstubAllEnvs();vi.unstubAllGlobals();for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
function git(repo: string, args: string[]) { return execFileSync('/usr/bin/git', args, { cwd: repo, env: safeEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function fixtureRepo() { const repo = await temp(); git(repo, ['init', '--quiet']); await writeFile(join(repo, 'safe.ts'), 'export const value = 1;\n'); await mkdir(join(repo, 'nested')); await writeFile(join(repo, 'nested', '.env.local'), 'EXAMPLE=private'); git(repo, ['add', '.']); git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture']); return repo; }
async function until(check: () => Promise<boolean>, ms = 6000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await delay(40); } throw new Error('Timed out waiting for service condition'); }
describe('pilot service preparation', () => {
  it('backs off repeated connection failures to 60 seconds and resets after success', () => {
    expect([0,1,2,3,4,5,100].map(failures=>reconnectDelayMs(5000,failures))).toEqual([5000,5000,10000,20000,40000,60000,60000]);
    expect(reconnectDelayMs(5000,0)).toBe(5000);expect(reconnectDelayMs(60_000,1)).toBe(60_000);expect(reconnectDelayMs(1000,100)).toBe(60_000);
    expect(()=>reconnectDelayMs(0,1)).toThrow('Invalid');expect(()=>reconnectDelayMs(1000,-1)).toThrow('Invalid');
  });
  it('scopes optional deployment bypass to private-file HTTPS transport without subprocess exposure', async () => {
    const root=await temp();const credential=join(root,'credential');const bypass=join(root,'bypass');await writeFile(credential,'nsw_'+'a'.repeat(43),{mode:0o600});await writeFile(bypass,'dummy-bypass-value',{mode:0o600});
    for(const [key,value] of Object.entries({WORKER_CREDENTIAL_FILE:credential,WORKER_VERCEL_BYPASS_FILE:bypass,WORKER_STATE_DIR:join(root,'state'),WORKER_REPO:process.cwd(),CONTROL_PLANE_URL:'https://control.example.invalid',WORKER_ADAPTER:'simulated'}))vi.stubEnv(key,value);
    const config=await loadConfig();const fetchMock=vi.fn().mockResolvedValue(new Response('null',{status:200}));vi.stubGlobal('fetch',fetchMock);await new HttpTransport(config).call('poll');
    expect(fetchMock.mock.calls[0][0]).toBe('https://control.example.invalid/api/worker/poll');expect(fetchMock.mock.calls[0][1].headers['x-vercel-protection-bypass']).toBe('dummy-bypass-value');expect(fetchMock.mock.calls[0][1].redirect).toBe('error');expect(JSON.stringify(safeEnvironment())).not.toContain('bypass');
    await chmod(bypass,0o644);await expect(loadConfig()).rejects.toThrow('private');await chmod(bypass,0o600);vi.stubEnv('CONTROL_PLANE_URL','http://127.0.0.1:3101');vi.stubEnv('WORKER_ALLOW_LOCALHOST','1');await expect(loadConfig()).rejects.toThrow('HTTPS');
    expect(()=>new HttpTransport({url:'https://control.example.invalid/path',credential:'fixture',vercelBypass:'fixture'})).toThrow('origin');
  });
  it('renders a valid private LaunchAgent with restart/login settings and separate arguments', async () => {
    const root = await temp(); const plist = join(root, 'prepared.plist');
    const text = renderLaunchAgent('/test/a & b', '/test/private env', process.execPath); await writeFile(plist, text);
    execFileSync('/usr/bin/plutil', ['-lint', plist]);
    const parsed = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
    expect(parsed.ProgramArguments).toEqual([process.execPath, '--env-file=/test/private env', '--import', 'tsx', '/test/a & b/scripts/launchd-run.ts']);
    expect(parsed).toMatchObject({ RunAtLoad: true, KeepAlive: true, ThrottleInterval: 30, ExitTimeOut: 20, Umask: 63 });
    expect(text).not.toContain('WORKER_CREDENTIAL');
  });
  it('rejects public or tracked environment files without reading their values', async () => {
    const root = await temp(); await mkdir(join(root, 'apps/worker/src'), { recursive: true }); await writeFile(join(root, 'apps/worker/src/main.ts'), ''); git(root, ['init', '--quiet']);
    const env = join(root, 'private.env'); await writeFile(env, 'EXAMPLE=private', { mode: 0o644 });
    await expect(validateLaunchEnvironment(root, env)).rejects.toThrow('private'); await chmod(env, 0o600);
    await expect(validateLaunchEnvironment(root, env)).rejects.toThrow('ignored'); await writeFile(join(root, '.gitignore'), 'private.env\n');
    expect(await validateLaunchEnvironment(root, env)).toEqual({ repo: root, envFile: env });
    git(root, ['add', '-f', 'private.env']); await expect(validateLaunchEnvironment(root, env)).rejects.toThrow();
  });
  it('holds one OS lock across contenders, then releases it without deleting its inode', async () => {
    const root = await temp(); const lock = await acquireCoordinatorLock(root);
    try { const contenders = await Promise.allSettled(Array.from({ length: 4 }, () => acquireCoordinatorLock(root))); expect(contenders.every(x => x.status === 'rejected')).toBe(true); }
    finally { await lock.release(); }
    const again = await acquireCoordinatorLock(root); await again.release(); expect(await readFile(join(root, 'coordinator.flock'), 'utf8')).toBe('');
  });
  it('exports only committed regular source with deterministic omissions and blocks symlinks', async () => {
    const repo = await fixtureRepo(); const commit = git(repo, ['rev-parse', 'HEAD']); await writeFile(join(repo, 'safe.ts'), 'dirty'); await writeFile(join(repo, 'untracked.txt'), 'private');
    const target = await temp(); const first = await prepareExecutionWorkspace(repo, commit, target); const second = await prepareExecutionWorkspace(repo, commit, target);
    expect(first.manifest).toEqual(second.manifest); expect(first.manifest.executable).toBe(false); expect(first.manifest.excluded).toEqual([{ path: 'nested/.env.local', reason: 'Credential/configuration/data filename' }]);
    expect(await readFile(join(first.source, 'safe.ts'), 'utf8')).toBe('export const value = 1;\n'); expect(first.manifest.included.map(x => x.path)).toEqual(['safe.ts']);
    await symlink('/etc/passwd', join(repo, 'escape')); git(repo, ['add', 'escape']); git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'symlink']);
    await expect(prepareExecutionWorkspace(repo, git(repo, ['rev-parse', 'HEAD']), target)).rejects.toThrow('symlinks');
  });
  it('reports stale and stopped processes unhealthy', async () => {
    const root = await temp(); const h = { version: 1 as const, pid: process.pid, mode: 'simulated' as const, status: 'online' as const, startedAt: Date.now(), updatedAt: Date.now(), lastPollAt: Date.now(), activeJobs: 0, consecutiveFailures: 0, pollMs: 1000 };
    await writeHealth(root, h); expect((await readHealth(root)).healthy).toBe(true); await writeHealth(root, { ...h, updatedAt: 0 }); expect((await readHealth(root)).healthy).toBe(false); await writeHealth(root, { ...h, status: 'stopped' }); expect((await readHealth(root)).healthy).toBe(false);
    await writeHealth(root,{...h,status:'degraded',updatedAt:Date.now()-45_000,effectivePollMs:60_000});expect(await readHealth(root)).toMatchObject({healthy:false,fresh:true});
  });
  it('runs simulated polling, rejects a duplicate, restarts after a crash, and stops cleanly', async () => {
    const root = await temp(); const state = join(root, 'state'); const credential = join(root, 'credential'); await writeFile(credential, 'nsw_' + 'a'.repeat(43), { mode: 0o600 });
    let polls = 0; const server = createServer((req, res) => { req.resume(); res.setHeader('content-type', 'application/json'); if (req.url?.endsWith('/poll')) polls++; res.end('null'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture server');
    const launch = () => { const child = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/src/main.ts'], { cwd: process.cwd(), env: { ...safeEnvironment(), CONTROL_PLANE_URL: `http://127.0.0.1:${address.port}`, WORKER_ALLOW_LOCALHOST: '1', WORKER_ADAPTER: 'simulated', WORKER_CREDENTIAL_FILE: credential, WORKER_STATE_DIR: state, WORKER_REPO: resolve('.'), WORKER_POLL_MS: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child); child.stdout?.resume(); child.stderr?.resume(); return child; };
    try {
      const first = launch(); await until(async () => (await readHealth(state)).healthy); expect(polls).toBeGreaterThan(0);
      const duplicate = launch(); await until(async () => duplicate.exitCode !== null); expect(duplicate.exitCode).toBe(1); expect((await readHealth(state)).health?.pid).toBe(first.pid);
      first.kill('SIGKILL'); await until(async () => first.signalCode !== null); const restarted = launch(); await until(async () => (await readHealth(state)).health?.pid === restarted.pid && (await readHealth(state)).healthy);
      restarted.kill('SIGTERM'); await until(async () => restarted.exitCode !== null); expect(restarted.exitCode).toBe(0); expect((await readHealth(state)).health?.status).toBe('stopped'); expect((await readHealth(state)).healthy).toBe(false);
    } finally { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 15_000);
});
