import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { badRequest, gone, notFound, unauthorized } from '../lib/errors';
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from '../services/encryption';
import { generateTotpSecret, TOTP_STEP_SECONDS } from '../services/totp';
import { decodePublicKey, enrollMessage, verifySignature } from '../services/signature';
import { generateRecoveryCodes } from '../services/recovery';
import { writeAudit } from '../services/audit';
import { parsed } from '../middleware/validate';

/** Identifies our QR payloads so the app can reject unrelated QR codes. */
export const ENROLL_QR_TYPE = 'mrra-enroll';

export const createSessionSchema = z.object({
  employeeId: z.string().uuid(),
});

export async function createEnrollmentSession(req: Request, res: Response) {
  const { employeeId } = parsed(res, createSessionSchema);
  const admin = req.user!;

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw notFound('Employee not found');
  if (!employee.active) throw badRequest('Employee is deactivated', 'EMPLOYEE_INACTIVE');

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + env.ENROLLMENT_SESSION_TTL_SECONDS * 1000);

  const session = await prisma.$transaction(async (tx) => {
    // Only one live session per employee: invalidate any earlier unused ones.
    await tx.enrollmentSession.updateMany({
      where: { employeeId, usedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });
    const s = await tx.enrollmentSession.create({
      data: {
        employeeId,
        tokenHash: sha256Hex(token),
        totpSecret: encryptSecret(generateTotpSecret(), env.TOTP_ENCRYPTION_KEY),
        createdBy: admin.id,
        expiresAt,
      },
    });
    await writeAudit(
      {
        employeeId,
        action: 'CREATE_ENROLLMENT_SESSION',
        ipAddress: req.ip,
        metadata: { actorId: admin.id, actorEmail: admin.email, sessionId: s.id },
      },
      tx,
    );
    return s;
  });

  res.status(201).json({
    sessionId: session.id,
    expiresAt: session.expiresAt,
    employee: { id: employee.id, name: employee.name, email: employee.email },
    // The token is returned exactly once, only to the admin dashboard, for QR display.
    qrPayload: JSON.stringify({ t: ENROLL_QR_TYPE, v: 1, token }),
  });
}

export async function getEnrollmentSession(req: Request, res: Response) {
  const session = await prisma.enrollmentSession.findUnique({
    where: { id: String(req.params.id) },
    select: { id: true, employeeId: true, expiresAt: true, usedAt: true, deviceId: true },
  });
  if (!session) throw notFound('Enrollment session not found');
  const status = session.usedAt ? 'COMPLETED' : session.expiresAt <= new Date() ? 'EXPIRED' : 'PENDING';
  res.json({ ...session, status });
}

export const completeEnrollmentSchema = z.object({
  token: z.string().min(20).max(200),
  publicKey: z.string().min(40).max(64),
  /** Proof of possession: Ed25519 signature of enrollMessage(token, publicKey). */
  signature: z.string().min(80).max(100),
  deviceName: z.string().trim().max(100).optional(),
  pushToken: z.string().min(10).max(4096).optional(),
  pushPlatform: z.enum(['fcm', 'apns']).optional(),
});

export async function completeEnrollment(req: Request, res: Response) {
  const body = parsed(res, completeEnrollmentSchema);

  if (!decodePublicKey(body.publicKey)) throw badRequest('Invalid Ed25519 public key', 'BAD_PUBLIC_KEY');
  if (!verifySignature(enrollMessage(body.token, body.publicKey), body.signature, body.publicKey)) {
    throw unauthorized('Key possession proof failed', 'BAD_SIGNATURE');
  }

  const session = await prisma.enrollmentSession.findUnique({
    where: { tokenHash: sha256Hex(body.token) },
    include: { employee: { select: { id: true, name: true, email: true, active: true } } },
  });
  if (!session) throw unauthorized('Invalid enrollment code', 'ENROLL_INVALID');
  if (session.usedAt) throw gone('This enrollment code was already used', 'ENROLL_USED');
  if (session.expiresAt <= new Date()) throw gone('This enrollment code has expired', 'ENROLL_EXPIRED');
  if (!session.employee.active) throw unauthorized('Employee is deactivated', 'EMPLOYEE_INACTIVE');

  // bcrypt work happens before the transaction to keep the transaction short.
  const recovery = await generateRecoveryCodes();

  const device = await prisma.$transaction(async (tx) => {
    // Atomic single-use claim: a concurrent second request sees count === 0.
    const claim = await tx.enrollmentSession.updateMany({
      where: { id: session.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claim.count !== 1) throw gone('This enrollment code was already used', 'ENROLL_USED');

    const d = await tx.device.create({
      data: {
        employeeId: session.employeeId,
        deviceName: body.deviceName,
        publicKey: body.publicKey,
        keyAlgorithm: 'Ed25519',
        totpSecret: session.totpSecret,
        pushToken: body.pushToken,
        pushPlatform: body.pushToken ? body.pushPlatform ?? null : null,
        recoveryCodes: { create: recovery.hashes.map((codeHash) => ({ codeHash })) },
      },
    });
    await tx.enrollmentSession.update({ where: { id: session.id }, data: { deviceId: d.id } });
    await writeAudit(
      {
        employeeId: session.employeeId,
        action: 'ENROLL',
        ipAddress: req.ip,
        metadata: { deviceId: d.id, deviceName: body.deviceName ?? null, sessionId: session.id },
      },
      tx,
    );
    return d;
  });

  res.status(201).json({
    deviceId: device.id,
    employee: { id: session.employee.id, name: session.employee.name, email: session.employee.email },
    // Delivered once over TLS to the key-holding device; stored in expo-secure-store.
    totp: {
      secret: decryptSecret(session.totpSecret, env.TOTP_ENCRYPTION_KEY),
      issuer: env.TOTP_ISSUER,
      accountName: session.employee.email,
      algorithm: 'SHA1',
      digits: 6,
      period: TOTP_STEP_SECONDS,
    },
    recoveryCodes: recovery.plain,
  });
}
