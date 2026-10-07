import type { AuthType, EndpointKind, EndpointRole, LastCall, RunStage } from '@precious/shared';

export const KIND_LABEL: Record<EndpointKind, string> = { rest: 'REST', graphql: 'GraphQL', html: 'HTML' };

export const ROLE_LABEL: Record<EndpointRole, string> = {
  search: 'Search',
  lookup: 'Look up details',
  compute: 'Keep a value up to date',
};

export const AUTH_LABEL: Record<AuthType, string> = {
  none: 'None',
  apiKey: 'API key',
  bearer: 'Bearer token',
  basic: 'User and password',
  oauth2: 'OAuth2 client credentials',
};

export const STAGE_LABEL: Record<RunStage, string> = {
  template: 'Building the request',
  auth: 'Signing in',
  http: 'Network',
  parse: 'Reading the response',
  extract: 'Picking out data',
  map: 'Mapping',
  validate: 'Checking the result',
};

export function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export function lastCallText(c: LastCall | null): string {
  if (!c) return 'Not used yet';
  if (c.ok) return `OK · ${ago(c.at)}`;
  return `${c.message ?? 'Failed'} · ${ago(c.at)}`;
}
