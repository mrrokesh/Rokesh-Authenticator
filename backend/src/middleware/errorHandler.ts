import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors';
import { isProd } from '../config/env';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  // Log the error type/message and route only — never request bodies (may contain codes/secrets).
  const e = err as Error;
  console.error(`[error] ${req.method} ${req.path}: ${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`);
  if (!isProd && e?.stack) console.error(e.stack);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
