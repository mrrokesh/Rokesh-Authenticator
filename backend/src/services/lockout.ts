import type { Employee, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { locked } from '../lib/errors';
import { writeAudit } from './audit';

type Tx = Prisma.TransactionClient;

export const isLocked = (e: Pick<Employee, 'lockedUntil'>, now = new Date()) =>
  !!e.lockedUntil && e.lockedUntil > now;

export function assertNotLocked(e: Pick<Employee, 'lockedUntil'>) {
  if (isLocked(e)) throw locked('Account temporarily locked after repeated failed attempts', 'ACCOUNT_LOCKED');
}

/** Atomically increments the failure counter; locks the account when the threshold is reached. */
export async function registerFailure(employeeId: string, ipAddress: string | undefined, tx: Tx = prisma) {
  const updated = await tx.employee.update({
    where: { id: employeeId },
    data: { failedAttempts: { increment: 1 } },
    select: { failedAttempts: true },
  });
  if (updated.failedAttempts >= env.MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + env.LOCKOUT_MINUTES * 60_000);
    await tx.employee.update({ where: { id: employeeId }, data: { lockedUntil, failedAttempts: 0 } });
    await writeAudit({ employeeId, action: 'LOCKOUT', ipAddress, metadata: { lockedUntil: lockedUntil.toISOString() } }, tx);
  }
}

export function resetFailures(employeeId: string, tx: Tx = prisma) {
  return tx.employee.update({ where: { id: employeeId }, data: { failedAttempts: 0, lockedUntil: null } });
}
