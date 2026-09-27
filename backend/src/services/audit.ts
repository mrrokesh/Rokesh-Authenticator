import type { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  employeeId: string;
  action: AuditAction;
  ipAddress?: string | null;
  /** Never put secrets, codes, tokens or keys here. */
  metadata?: Prisma.InputJsonValue;
}

export function writeAudit(entry: AuditEntry, tx: Tx = prisma) {
  return tx.auditLog.create({
    data: {
      employeeId: entry.employeeId,
      action: entry.action,
      ipAddress: entry.ipAddress ?? null,
      metadata: entry.metadata,
    },
  });
}
