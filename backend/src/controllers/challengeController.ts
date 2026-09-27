import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { conflict, gone, notFound, unauthorized } from '../lib/errors';
import { randomToken, timingSafeEqualStr } from '../services/encryption';
import { isFreshTimestamp, respondMessage, verifySignature } from '../services/signature';
import { sendLoginPush, type PushPlatform } from '../services/push';
import { writeAudit } from '../services/audit';
import { assertNotLocked } from '../services/lockout';
import { parsed } from '../middleware/validate';

/* ------------------- Company system: create + poll ------------------- */

export const createLoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  /** Name of the system the employee is signing in to (shown on the phone). */
  application: z.string().trim().min(1).max(100).optional(),
  /** IP address of the employee's sign-in attempt (shown on the phone). */
  requestIp: z.string().trim().max(64).optional(),
});

export async function createLoginRequest(req: Request, res: Response) {
  const body = parsed(res, createLoginRequestSchema);

  const employee = await prisma.employee.findUnique({ where: { email: body.email } });
  if (!employee || !employee.active) throw notFound('No active employee with that email', 'EMPLOYEE_NOT_FOUND');
  assertNotLocked(employee);

  const device = await prisma.device.findFirst({
    where: { employeeId: employee.id, revoked: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!device) throw notFound('Employee has no enrolled device', 'NO_DEVICE');

  const expiresAt = new Date(Date.now() + env.LOGIN_CHALLENGE_TTL_SECONDS * 1000);
  const challenge = await prisma.$transaction(async (tx) => {
    const c = await tx.loginChallenge.create({
      data: {
        deviceId: device.id,
        nonce: randomToken(32),
        application: body.application,
        requestIp: body.requestIp,
        expiresAt,
      },
    });
    await writeAudit(
      {
        employeeId: employee.id,
        action: 'LOGIN_REQUEST',
        ipAddress: body.requestIp ?? req.ip,
        metadata: { challengeId: c.id, deviceId: device.id, application: body.application ?? null },
      },
      tx,
    );
    return c;
  });

  // Push carries only the challenge id. The nonce is fetched by the device over a signed request.
  let push: { delivered: boolean; error?: string } = { delivered: false, error: 'no_push_token' };
  if (device.pushToken && device.pushPlatform) {
    const result = await sendLoginPush(device.pushPlatform as PushPlatform, device.pushToken, {
      challengeId: challenge.id,
      application: challenge.application,
      expiresAt,
    });
    push = { delivered: result.delivered, error: result.error };
    if (result.invalidToken) {
      await prisma.device.update({ where: { id: device.id }, data: { pushToken: null, pushPlatform: null } });
    }
    if (!result.delivered) console.warn(`[push] challenge ${challenge.id} not delivered: ${result.error}`);
  }

  res.status(201).json({
    challengeId: challenge.id,
    status: challenge.status,
    expiresAt,
    pushDelivered: push.delivered,
    pushError: push.error,
  });
}

export async function getLoginRequestStatus(req: Request, res: Response) {
  const id = String(req.params.id);
  await expireIfStale(id);
  const c = await prisma.loginChallenge.findUnique({
    where: { id },
    select: { id: true, status: true, expiresAt: true, respondedAt: true, createdAt: true },
  });
  if (!c) throw notFound('Login request not found');
  res.json(c);
}

async function expireIfStale(id: string) {
  await prisma.loginChallenge.updateMany({
    where: { id, status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED' },
  });
}

/* --------------------------- Device: respond --------------------------- */

export const respondSchema = z.object({
  challengeId: z.string().uuid(),
  nonce: z.string().min(20).max(100),
  decision: z.enum(['APPROVE', 'DENY']),
  timestamp: z.number().int().positive(),
  signature: z.string().min(80).max(100),
});

export async function respondToLoginRequest(req: Request, res: Response) {
  const body = parsed(res, respondSchema);

  const challenge = await prisma.loginChallenge.findUnique({
    where: { id: body.challengeId },
    include: { device: { include: { employee: { select: { id: true, active: true } } } } },
  });
  if (!challenge) throw notFound('Login request not found');
  const { device } = challenge;
  if (device.revoked || !device.employee.active) throw unauthorized('Device revoked', 'DEVICE_REVOKED');

  if (!isFreshTimestamp(body.timestamp)) throw unauthorized('Stale signature timestamp', 'STALE_TIMESTAMP');
  if (!timingSafeEqualStr(body.nonce, challenge.nonce)) throw unauthorized('Nonce mismatch', 'BAD_NONCE');
  const message = respondMessage(challenge.id, challenge.nonce, body.decision, body.timestamp);
  if (!verifySignature(message, body.signature, device.publicKey)) {
    throw unauthorized('Signature verification failed', 'BAD_SIGNATURE');
  }

  const status = body.decision === 'APPROVE' ? 'APPROVED' : 'DENIED';
  await prisma.$transaction(async (tx) => {
    // Single-use + expiry enforced atomically: only a PENDING, unexpired challenge can transition.
    const updated = await tx.loginChallenge.updateMany({
      where: { id: challenge.id, nonce: challenge.nonce, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: { status, respondedAt: new Date() },
    });
    if (updated.count !== 1) {
      if (challenge.status === 'PENDING' && challenge.expiresAt <= new Date()) {
        throw gone('Login request expired', 'CHALLENGE_EXPIRED');
      }
      throw conflict('Login request already answered', 'CHALLENGE_CONSUMED');
    }
    await writeAudit(
      {
        employeeId: device.employeeId,
        action: body.decision === 'APPROVE' ? 'APPROVE' : 'DENY',
        ipAddress: req.ip,
        metadata: { challengeId: challenge.id, deviceId: device.id, application: challenge.application },
      },
      tx,
    );
  }).catch(async (err) => {
    // Persist the EXPIRED status outside the rolled-back transaction.
    if ((err as { code?: string }).code === 'CHALLENGE_EXPIRED') await expireIfStale(challenge.id);
    throw err;
  });

  res.json({ challengeId: challenge.id, status });
}
