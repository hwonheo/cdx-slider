import { execFileSync } from 'node:child_process';

// Restrict status to the registered directory, including when Git discovers an ancestor repository.
export function gitSnapshot(path) {
  const git = (...args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', path, ...args], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  try {
    const root = git('rev-parse', '--show-toplevel').trim();
    let head = null;
    try { head = git('rev-parse', '--verify', 'HEAD').trim(); } catch {}
    const status = git('status', '--porcelain=v1', '-z', '--', '.');
    let branch = null;
    try { branch = git('symbolic-ref', '--short', 'HEAD').trim(); } catch {}
    return { root, head, branch, dirty: !!status, status };
  } catch { return null; }
}
