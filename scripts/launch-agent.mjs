// launchd can report EIO briefly after bootout while the old job is being removed.
// Retry only that transient status; permission and other failures remain visible.
export function bootstrapAgent(run, domain, plist, { wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return run('bootstrap', domain, plist); }
    catch (error) {
      if (error.status !== 5 || attempt >= 5) throw error;
      wait(250 * (attempt + 1));
    }
  }
}
