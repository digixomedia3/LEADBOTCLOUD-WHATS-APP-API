import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticate, clientIdOf } from '@/lib/api-auth';
import { problem } from '@/lib/api-route';
import { buildServer } from '@/lib/mcp-server';

export const dynamic = 'force-dynamic';

/**
 * MCP endpoint (Streamable HTTP, stateless). Add it to Claude, Hermes or any MCP client as
 *   URL: https://<your-app>/api/mcp      Header: Authorization: Bearer lbc_...
 * Every request carries the key, so there are no sessions to hijack.
 */
async function handle(req: Request): Promise<Response> {
  // A browser page on another site must not be able to drive this with a visitor's key (DNS-rebinding / cross-site defence required by the MCP spec).
  const origin = req.headers.get('origin');
  if (origin) {
    const allowed = (process.env.APP_URL ?? '').replace(/\/$/, '');
    if (!allowed || origin.replace(/\/$/, '') !== allowed) return problem(403, 'Browser requests from other sites are not allowed.');
  }
  const auth = await authenticate(req.headers, clientIdOf(req));
  if (!auth.ok) return problem(auth.status, auth.error, {}, auth.retryAfter ? { 'retry-after': String(auth.retryAfter) } : {});
  if (req.method !== 'POST') return problem(405, 'Use POST.', {}, { allow: 'POST' });
  const server = buildServer(auth.ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
