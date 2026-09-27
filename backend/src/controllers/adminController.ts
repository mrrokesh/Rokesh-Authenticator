import type { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';
import { writeAudit } from '../services/audit';
import { parsed } from '../middleware/validate';

const password = z.string().min(12, 'Password must be at least 12 characters').max(200);

/* ------------------------------ Employees ------------------------------ */

export const listEmployeesQuery = z.object({
  search: z.string().trim().max(100).optional(),
});

export async function listEmployees(_req: Request, res: Response) {
  const { search } = parsed(res, listEmployeesQuery, 'query');
  const employees = await prisma.employee.findMany({
    where: search
      ? { OR: [{ email: { contains: search, mode: 'insensitive' } }, { name: { contains: search, mode: 'insensitive' } }] }
      : undefined,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      lockedUntil: true,
      createdAt: true,
      _count: { select: { devices: { where: { revoked: false } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({
    employees: employees.map(({ _count, ...e }) => ({ ...e, activeDevices: _count.devices })),
  });
}

export const createEmployeeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['ADMIN', 'EMPLOYEE']).default('EMPLOYEE'),
  /** Only needed for accounts that sign in to the admin dashboard. */
  password: password.optional(),
});

export async function createEmployee(req: Request, res: Response) {
  const body = parsed(res, createEmployeeSchema);
  if (body.role === 'ADMIN' && !body.password) throw badRequest('Admins need a password to sign in');
  const passwordHash = body.password ? await bcrypt.hash(body.password, 12) : null;

  try {
    const employee = await prisma.$transaction(async (tx) => {
      const e = await tx.employee.create({
        data: { email: body.email, name: body.name, role: body.role, passwordHash },
        select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      });
      await writeAudit(
        {
          employeeId: e.id,
          action: 'CREATE_EMPLOYEE',
          ipAddress: req.ip,
          metadata: { actorId: req.user!.id, actorEmail: req.user!.email, role: e.role },
        },
        tx,
      );
      return e;
    });
    res.status(201).json({ employee });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('An employee with that email already exists', 'EMAIL_TAKEN');
    }
    throw err;
  }
}

export const updateEmployeeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(['ADMIN', 'EMPLOYEE']).optional(),
    active: z.boolean().optional(),
    password: password.optional(),
    unlock: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No changes supplied');

export async function updateEmployee(req: Request, res: Response) {
  const body = parsed(res, updateEmployeeSchema);
  const id = String(req.params.id);
  const actor = req.user!;

  if (id === actor.id && (body.active === false || body.role === 'EMPLOYEE')) {
    throw badRequest('You cannot deactivate or demote your own account', 'SELF_LOCKOUT');
  }
  const existing = await prisma.employee.findUnique({ where: { id } });
  if (!existing) throw notFound('Employee not found');

  const data: Prisma.EmployeeUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.role !== undefined) data.role = body.role;
  if (body.active !== undefined) data.active = body.active;
  if (body.password) data.passwordHash = await bcrypt.hash(body.password, 12);
  if (body.unlock) {
    data.lockedUntil = null;
    data.failedAttempts = 0;
  }

  const employee = await prisma.$transaction(async (tx) => {
    const e = await tx.employee.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, active: true, lockedUntil: true },
    });
    if (body.active === false) {
      // Deactivation ends all dashboard sessions immediately.
      await tx.refreshToken.updateMany({ where: { employeeId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await writeAudit(
      {
        employeeId: id,
        action: 'UPDATE_EMPLOYEE',
        ipAddress: req.ip,
        metadata: {
          actorId: actor.id,
          actorEmail: actor.email,
          changed: Object.keys(body).map((k) => (k === 'password' ? 'password(reset)' : k)),
        },
      },
      tx,
    );
    return e;
  });
  res.json({ employee });
}

/* ------------------------------- Devices ------------------------------- */

export const listDevicesQuery = z.object({
  employeeId: z.string().uuid().optional(),
  includeRevoked: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export async function listDevices(_req: Request, res: Response) {
  const { employeeId, includeRevoked } = parsed(res, listDevicesQuery, 'query');
  const devices = await prisma.device.findMany({
    where: { employeeId, ...(includeRevoked ? {} : { revoked: false }) },
    // Never select totpSecret.
    select: {
      id: true,
      deviceName: true,
      keyAlgorithm: true,
      pushPlatform: true,
      pushToken: true,
      revoked: true,
      revokedAt: true,
      createdAt: true,
      employee: { select: { id: true, name: true, email: true } },
      _count: { select: { recoveryCodes: { where: { used: false } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json({
    devices: devices.map(({ _count, pushToken, ...d }) => ({
      ...d,
      pushRegistered: !!pushToken,
      unusedRecoveryCodes: _count.recoveryCodes,
    })),
  });
}

export const revokeDeviceSchema = z.object({
  deviceId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

export async function revokeDevice(req: Request, res: Response) {
  const { deviceId, reason } = parsed(res, revokeDeviceSchema);
  const actor = req.user!;

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw notFound('Device not found');

  await prisma.$transaction(async (tx) => {
    const updated = await tx.device.updateMany({
      where: { id: deviceId, revoked: false },
      data: { revoked: true, revokedAt: new Date(), pushToken: null, pushPlatform: null },
    });
    if (updated.count !== 1) throw conflict('Device is already revoked', 'ALREADY_REVOKED');
    await tx.loginChallenge.updateMany({ where: { deviceId, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    await writeAudit(
      {
        employeeId: device.employeeId,
        action: 'REVOKE',
        ipAddress: req.ip,
        metadata: { actorId: actor.id, actorEmail: actor.email, deviceId, reason: reason ?? null },
      },
      tx,
    );
  });
  res.json({ deviceId, revoked: true });
}

/* ------------------------------ Audit logs ------------------------------ */

export const auditQuery = z.object({
  employeeId: z.string().uuid().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

export async function listAuditLogs(_req: Request, res: Response) {
  const { employeeId, action, limit, cursor } = parsed(res, auditQuery, 'query');
  const logs = await prisma.auditLog.findMany({
    where: { employeeId, action },
    include: { employee: { select: { id: true, name: true, email: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = logs.length > limit;
  const page = hasMore ? logs.slice(0, limit) : logs;
  res.json({ logs: page, nextCursor: hasMore ? page[page.length - 1].id : null });
}
