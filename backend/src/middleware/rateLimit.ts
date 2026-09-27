import type { Request } from 'express';
import rateLimit from 'express-rate-limit';

const make = (limit: number, windowMs: number, message: string, keyGenerator?: (req: Request) => string) =>
  rateLimit({
    windowMs,
    limit,
    ...(keyGenerator ? { keyGenerator } : {}),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message } },
  });

export const authLimiter = make(10, 15 * 60_000, 'Too many login attempts, try again later');
export const refreshLimiter = make(60, 15 * 60_000, 'Too many session refreshes, try again later');
// Called server-to-server by company systems, so limit per target employee rather than per IP.
const byEmployeeEmail = (req: Request) => `email:${String(req.body?.email ?? '').trim().toLowerCase()}`;
export const totpLimiter = make(20, 15 * 60_000, 'Too many verification attempts, try again later', byEmployeeEmail);
export const loginRequestLimiter = make(10, 60_000, 'Too many login requests for this employee', byEmployeeEmail);
export const enrollLimiter = make(10, 15 * 60_000, 'Too many enrollment attempts, try again later');
export const respondLimiter = make(60, 60_000, 'Too many responses, slow down');
export const deviceLimiter = make(120, 60_000, 'Too many device requests, slow down');
export const globalLimiter = make(600, 15 * 60_000, 'Too many requests');
