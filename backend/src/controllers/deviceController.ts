import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { notFound } from '../lib/errors';
import { parsed } from '../middleware/validate';

/** Lets the app confirm it is still enrolled (revocation shows up as 401 DEVICE_REVOKED). */
export async function deviceMe(req: Request, res: Response) {
  const device = await prisma.device.findUniqueOrThrow({
    where: { id: req.device!.id },
    select: {
      id: true,
      deviceName: true,
      pushToken: true,
      pushPlatform: true,
      createdAt: true,
      employee: { select: { name: true, email: true } },
      _count: { select: { recoveryCodes: { where: { used: false } } } },
    },
  });
  res.json({
    deviceId: device.id,
    deviceName: device.deviceName,
    enrolledAt: device.createdAt,
    // Whether the server can currently push to this device (the token itself is not echoed back).
    pushRegistered: !!device.pushToken,
    pushPlatform: device.pushPlatform,
    employee: device.employee,
    unusedRecoveryCodes: device._count.recoveryCodes,
  });
}

const challengeSelect = {
  id: true,
  nonce: true,
  status: true,
  application: true,
  requestIp: true,
  createdAt: true,
  expiresAt: true,
} as const;

export async function listPendingChallenges(req: Request, res: Response) {
  const challenges = await prisma.loginChallenge.findMany({
    where: { deviceId: req.device!.id, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: challengeSelect,
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  res.json({ challenges });
}

export async function getChallenge(req: Request, res: Response) {
  const challenge = await prisma.loginChallenge.findFirst({
    where: { id: String(req.params.id), deviceId: req.device!.id },
    select: challengeSelect,
  });
  if (!challenge) throw notFound('Login request not found');
  const expired = challenge.status === 'PENDING' && challenge.expiresAt <= new Date();
  res.json({ challenge: { ...challenge, status: expired ? 'EXPIRED' : challenge.status } });
}

export const pushTokenSchema = z.object({
  pushToken: z.string().min(10).max(4096),
  pushPlatform: z.enum(['fcm', 'apns']),
});

export async function updatePushToken(req: Request, res: Response) {
  const { pushToken, pushPlatform } = parsed(res, pushTokenSchema);
  await prisma.device.update({ where: { id: req.device!.id }, data: { pushToken, pushPlatform } });
  res.status(204).end();
}
