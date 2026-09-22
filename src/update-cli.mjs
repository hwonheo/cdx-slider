import { check, readState, status, patchState, performUpdate, recover } from './updates.mjs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
const [action = 'status', target = join(homedir(), 'plugins/cdx-slider')] = process.argv.slice(2);
const root = resolve(target);
try {
  let result;
  if (action === 'status') result = status();
  else if (action === 'check') result = await check(root);
  else if (action === 'apply') { await performUpdate(root); result = readState(); }
  else if (action === 'auto-on' || action === 'auto-off') result = patchState({ automatic: action === 'auto-on' });
  else if (action === 'recover') result = recover(root);
  else throw Error('Usage: npm run update -- status|check|apply|auto-on|auto-off|recover [staged-plugin-path]');
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
