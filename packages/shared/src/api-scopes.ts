/** Permissions an API key can have. Plain constants only (no Node modules), so the browser panel can import them. */
export const API_SCOPES = ['contacts:read', 'contacts:write', 'templates:read', 'campaigns:read', 'campaigns:write', 'campaigns:send'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_INFO: Record<ApiScope, { label: string; risk: 'read' | 'write' | 'spend' }> = {
  'contacts:read': { label: 'See contacts and groups', risk: 'read' },
  'contacts:write': { label: 'Add contacts and groups', risk: 'write' },
  'templates:read': { label: 'See approved templates', risk: 'read' },
  'campaigns:read': { label: 'See campaigns and how they did', risk: 'read' },
  'campaigns:write': { label: 'Create and cancel campaigns (does not send them)', risk: 'write' },
  'campaigns:send': { label: 'Start sending to customers (costs money)', risk: 'spend' },
};

/** What a new key gets if nothing else is chosen: it can look and prepare, but never message anyone or spend money. */
export const DEFAULT_SCOPES: ApiScope[] = ['contacts:read', 'contacts:write', 'templates:read', 'campaigns:read', 'campaigns:write'];

