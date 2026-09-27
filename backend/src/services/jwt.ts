import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';
import { env } from '../config/env';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  email: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign({ role: claims.role, email: claims.email }, env.JWT_PRIVATE_KEY, {
    algorithm: 'RS256',
    subject: claims.sub,
    issuer: env.JWT_ISSUER,
    audience: 'access',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, env.JWT_PUBLIC_KEY, {
    algorithms: ['RS256'],
    issuer: env.JWT_ISSUER,
    audience: 'access',
  });
  if (typeof payload === 'string' || !payload.sub) throw new Error('Malformed token');
  return { sub: payload.sub, role: payload.role as UserRole, email: payload.email as string };
}
