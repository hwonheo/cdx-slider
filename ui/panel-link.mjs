// Deep links select stored data only. They are never proof of a current task ID.
export function panelLinkContext(context) {
  const link = context?.['openai/deepLink'];
  if (!link) return null;
  const query = typeof link.url === 'string'
    ? new URL(link.url, 'https://panel.invalid').searchParams
    : new URLSearchParams(link.query || []);
  const profile = query.get('profile'), project = query.get('project');
  if (!profile && !project) return {};
  if (![profile, project].every(value => /^[a-z0-9][a-z0-9-]{0,63}$/.test(value || ''))) {
    throw new Error('Invalid panel profile or project link.');
  }
  return { profile, project };
}
