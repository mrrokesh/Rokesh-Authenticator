import type { Request, Response, CookieOptions } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env, isProd } from '../config/env';
import { unauthorized } from '../lib/errors';
import { signAccessToken } from '../services/jwt';
import { randomToken, sha256Hex } from '../services/encryption';
import { writeAudit } from '../services/audit';
import { assertNotLocked, registerFailure, resetFailures } from '../services/lockout';
import { parsed } from '../middleware/validate';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const REFRESH_COOKIE = 'mrra_refresh';

// Used to keep response timing similar when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 12);

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: isProd,
  // Dashboard and API are usually on different sites in production (e.g. Vercel + Railway).
  sameSite: isProd ? 'none' : 'lax',
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
});

async function issueTokens(res: Response, employee: { id: string; email: string; role: 'ADMIN' | 'EMPLOYEE' }) {
  const refreshToken = randomToken(48);
  await prisma.refreshToken.create({
    data: {
      employeeId: employee.id,
      tokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000),
    },
  });
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  return {
    accessToken: signAccessToken({ sub: employee.id, email: employee.email, role: employee.role }),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    user: employee,
  };
}

export async function login(req: Request, res: Response) {
  const { email, password } = parsed(res, loginSchema);
  const employee = await prisma.employee.findUnique({ where: { email } });

  if (!employee || !employee.passwordHash) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  assertNotLocked(employee);

  const ok = await bcrypt.compare(password, employee.passwordHash);
  if (!ok || !employee.active) {
    await prisma.$transaction(async (tx) => {
      await registerFailure(employee.id, req.ip, tx);
      await writeAudit({ employeeId: employee.id, action: 'LOGIN_FAILED', ipAddress: req.ip }, tx);
    });
    throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  await prisma.$transaction(async (tx) => {
    await resetFailures(employee.id, tx);
    await writeAudit({ employeeId: employee.id, action: 'LOGIN', ipAddress: req.ip }, tx);
  });

  res.json(await issueTokens(res, { id: employee.id, email: employee.email, role: employee.role }));
}

export async function refresh(req: Request, res: Response) {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('No refresh token', 'NO_REFRESH');

  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { employee: { select: { id: true, email: true, role: true, active: true } } },
  });
  if (!record) throw unauthorized('Invalid refresh token', 'REFRESH_INVALID');

  if (record.revokedAt) {
    // A rotated-out token was presented again: assume theft and revoke the whole family.
    await prisma.refreshToken.updateMany({
      where: { employeeId: record.employeeId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    throw unauthorized('Refresh token reuse detected', 'REFRESH_REUSED');
  }
  if (record.expiresAt <= new Date() || !record.employee.active) {
    throw unauthorized('Refresh token expired', 'REFRESH_EXPIRED');
  }

  const claimed = await prisma.refreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) throw unauthorized('Refresh token already used', 'REFRESH_REUSED');

  const { id, email, role } = record.employee;
  res.json(await issueTokens(res, { id, email, role }));
}

export async function logout(req: Request, res: Response) {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (record && !record.revokedAt) {
      await prisma.$transaction(async (tx) => {
        await tx.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
        await writeAudit({ employeeId: record.employeeId, action: 'LOGOUT', ipAddress: req.ip }, tx);
      });
    }
  }
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: req.user!.id },
    select: { id: true, email: true, name: true, role: true },
  });
  res.json({ user: employee });
}
