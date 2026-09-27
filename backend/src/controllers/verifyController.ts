import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { notFound } from '../lib/errors';
import { decryptSecret } from '../services/encryption';
import { verifyTotp } from '../services/totp';
import { normalizeRecoveryCode } from '../services/recovery';
import { writeAudit } from '../services/audit';
import { assertNotLocked, registerFailure, resetFailures } from '../services/lockout';
import { parsed } from '../middleware/validate';

async function loadEmployee(email: string) {
  const employee = await prisma.employee.findUnique({ where: { email } });
  if (!employee || !employee.active) throw notFound('No active employee with that email', 'EMPLOYEE_NOT_FOUND');
  assertNotLocked(employee);
  return employee;
}

async function recordFailure(employeeId: string, ip: string | undefined, action: 'TOTP_FAILED' | 'RECOVERY_FAILED', reason: string) {
  await prisma.$transaction(async (tx) => {
    await registerFailure(employeeId, ip, tx);
    await writeAudit({ employeeId, action, ipAddress: ip, metadata: { reason } }, tx);
  });
}

/* ------------------------------- TOTP ------------------------------- */

export const totpVerifySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().regex(/^\d{6}$/, 'code must be 6 digits'),
});

export async function verifyTotpCode(req: Request, res: Response) {
  const { email, code } = parsed(res, totpVerifySchema);
  const employee = await loadEmployee(email);

  const devices = await prisma.device.findMany({
    where: { employeeId: employee.id, revoked: false },
    select: { id: true, totpSecret: true, lastTotpStep: true },
  });

  let replayed = false;
  for (const device of devices) {
    const step = verifyTotp(code, decryptSecret(device.totpSecret, env.TOTP_ENCRYPTION_KEY));
    if (step === null) continue;

    // Accept each time-step at most once per device (prevents replay within the ±1 window).
    const claimed = await prisma.device.updateMany({
      where: { id: device.id, revoked: false, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: step } }] },
      data: { lastTotpStep: step },
    });
    if (claimed.count !== 1) {
      replayed = true;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await resetFailures(employee.id, tx);
      await writeAudit(
        { employeeId: employee.id, action: 'TOTP_VERIFIED', ipAddress: req.ip, metadata: { deviceId: device.id } },
        tx,
      );
    });
    return res.json({ valid: true, deviceId: device.id });
  }

  await recordFailure(employee.id, req.ip, 'TOTP_FAILED', replayed ? 'replayed' : devices.length ? 'mismatch' : 'no_device');
  res.json({ valid: false, reason: replayed ? 'CODE_ALREADY_USED' : 'INVALID_CODE' });
}

/* ---------------------------- Recovery codes ---------------------------- */

export const recoveryVerifySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().min(10).max(20),
});

export async function verifyRecoveryCode(req: Request, res: Response) {
  const { email, code } = parsed(res, recoveryVerifySchema);
  const employee = await loadEmployee(email);

  const normalized = normalizeRecoveryCode(code);
  if (!normalized) {
    await recordFailure(employee.id, req.ip, 'RECOVERY_FAILED', 'malformed');
    return res.json({ valid: false, reason: 'INVALID_CODE' });
  }

  const candidates = await prisma.recoveryCode.findMany({
    where: { used: false, device: { employeeId: employee.id, revoked: false } },
    select: { id: true, codeHash: true, deviceId: true },
  });

  for (const candidate of candidates) {
    if (!(await bcrypt.compare(normalized, candidate.codeHash))) continue;

    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.recoveryCode.updateMany({
        where: { id: candidate.id, used: false },
        data: { used: true, usedAt: new Date() },
      });
      if (claimed.count !== 1) return null;
      const remaining = await tx.recoveryCode.count({ where: { deviceId: candidate.deviceId, used: false } });
      await resetFailures(employee.id, tx);
      await writeAudit(
        {
          employeeId: employee.id,
          action: 'RECOVERY_CODE_USED',
          ipAddress: req.ip,
          metadata: { deviceId: candidate.deviceId, remaining },
        },
        tx,
      );
      return remaining;
    });
    if (result === null) break; // lost a race: the code was just used
    return res.json({ valid: true, deviceId: candidate.deviceId, remaining: result });
  }

  await recordFailure(employee.id, req.ip, 'RECOVERY_FAILED', 'mismatch');
  res.json({ valid: false, reason: 'INVALID_CODE' });
}
