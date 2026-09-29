import { vi } from 'vitest';

type Handler = (req: { body: unknown; headers: Record<string, string> }) => { status?: number; body?: unknown };

export interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Minimal fetch stand-in: routes "METHOD /path" (query string ignored unless included) to handlers
 * and records every call. Unmatched routes return 404 so a missing stub fails loudly.
 */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body, headers });
    const handler = routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`];
    const res = handler ? handler({ body, headers }) : { status: 404, body: { error: { code: 'NOT_FOUND', message: `no stub for ${method} ${url.pathname}` } } };
    const status = res.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(res.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}
