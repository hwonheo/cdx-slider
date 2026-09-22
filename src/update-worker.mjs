import { performUpdate } from './updates.mjs';
import { rmSync } from 'node:fs';
// Copied to the updater's data directory before starting, never run in the bar process.
try { await performUpdate(process.argv[2], process.argv[3], process.argv[4] === 'auto'); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (/\/worker-[a-f0-9-]+\.mjs$/.test(process.argv[1])) rmSync(process.argv[1], { force: true }); }
