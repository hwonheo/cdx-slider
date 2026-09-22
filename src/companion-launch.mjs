import { message } from './messages.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function openCompanion({ platform = process.platform, home = homedir(), exists = existsSync, exec = execFileSync, language = 'en' } = {}) {
  if (platform !== 'darwin') throw new Error(message('companionMacOnly', language));
  const candidates = [];
  try {
    const executable = exec('/usr/libexec/PlistBuddy', ['-c', 'Print :ProgramArguments:0', join(home, 'Library/LaunchAgents/local.cdx-slider.companion.plist')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (executable.endsWith('.app/Contents/MacOS/SliderBar')) candidates.push(executable.slice(0, -'/Contents/MacOS/SliderBar'.length));
  } catch {}
  candidates.push(fileURLToPath(new URL('./CDX Slider.app', import.meta.url)), resolve(fileURLToPath(new URL('../dist/CDX Slider.app', import.meta.url))));
  const path = candidates.find(path => {
    if (!exists(join(path, 'Contents/MacOS/SliderBar'))) return false;
    try { return exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(path, 'Contents/Info.plist')], { encoding: 'utf8' }).trim() === 'local.cdx-slider.companion'; } catch { return false; }
  });
  if (!path) throw new Error(message('companionMissing', language));
  exec('/usr/bin/open', [path], { stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: 'requested', message: message('companionRequested', language) };
}
