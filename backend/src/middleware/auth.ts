import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { verifyAccessToken } from '../services/jwt';
import { forbidden, unauthorized } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { timingSafeEqualStr } from '../services/encryption';

/** Verifies the RS256 access token and re-checks the employee is still active. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized('Missing bearer token'));

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    return next(unauthorized('Invalid or expired token', 'TOKEN_INVALID'));
  }

  const employee = await prisma.employee.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, role: true, active: true },
  });
  if (!employee || !employee.active) return next(unauthorized('Account disabled'));

  // Role is read from the database, not the token, so demotions take effect immediately.
  req.user = { id: employee.id, email: employee.email, role: employee.role };
  next();
}

export const requireRole =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('Insufficient role'));
    next();
  };

/** Company-system (server-to-server) authentication via X-API-Key. */
export function requireApiKey(req: Request, _res: Response, next: NextFunction) {
  const key = req.header('x-api-key');
  if (!key || !timingSafeEqualStr(key, env.COMPANY_API_KEY)) return next(unauthorized('Invalid API key'));
  next();
}
