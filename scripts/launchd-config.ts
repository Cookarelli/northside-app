import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { safeEnvironment } from '../apps/worker/src/process';

export const workerLabel = 'com.northside.supervised-worker';
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function renderLaunchAgent(repo: string, envFile: string, node: string): string {
  for (const path of [repo, envFile, node]) if (!isAbsolute(path) || /[\x00-\x1f]/.test(path)) throw new Error('LaunchAgent paths must be absolute with no control characters');
  const args = [node, `--env-file=${envFile}`, '--import', 'tsx', join(repo, 'scripts/launchd-run.ts')];
  const path = [dirname(node), '/opt/homebrew/bin', '/usr/bin', '/bin'].join(':');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${workerLabel}</string>
<key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(repo)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer><key>ExitTimeOut</key><integer>20</integer>
<key>Umask</key><integer>63</integer><key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
}
export async function validateLaunchEnvironment(repoInput: string, envInput: string) {
  const repo = await realpath(repoInput); const envFile = resolve(envInput);
  const info = await lstat(envFile);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid?.()) throw new Error('Worker environment file must be regular, private (chmod 600), and owned by this account');
  if (await realpath(envFile) !== envFile) throw new Error('Worker environment path must not traverse symlinks');
  await readFile(join(repo, 'apps/worker/src/main.ts'));
  const path = relative(repo, envFile);
  if (!path.startsWith('../') && !isAbsolute(path)) {
    try { execFileSync('git', ['check-ignore', '--quiet', '--', path], { cwd: repo, env: safeEnvironment(), stdio: 'ignore' }); }
    catch { throw new Error('Worker environment inside the repository must be ignored and untracked'); }
    try { execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd: repo, env: safeEnvironment(), stdio: 'ignore' }); }
    catch { return { repo, envFile }; }
    throw new Error('Worker environment must not be tracked');
  }
  return { repo, envFile };
}
