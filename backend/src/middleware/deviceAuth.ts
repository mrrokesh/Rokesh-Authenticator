import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { unauthorized } from '../lib/errors';
import { isFreshTimestamp, requestMessage, verifySignature } from '../services/signature';

/**
 * Authenticates a request made by an enrolled device.
 * Headers:
 *   X-Device-Id         device id returned at enrollment
 *   X-Device-Timestamp  unix ms, must be within ±60s of server time
 *   X-Device-Signature  base64 Ed25519 signature of requestMessage(method, originalUrl, timestamp, rawBody)
 * Revoked devices and inactive employees are rejected.
 */
export async function requireDevice(req: Request, _res: Response, next: NextFunction) {
  const deviceId = req.header('x-device-id');
  const timestamp = Number(req.header('x-device-timestamp'));
  const signature = req.header('x-device-signature');
  if (!deviceId || !signature || !isFreshTimestamp(timestamp)) {
    return next(unauthorized('Missing or stale device signature', 'DEVICE_AUTH'));
  }

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, employeeId: true, publicKey: true, revoked: true, employee: { select: { active: true } } },
  });
  if (!device || device.revoked || !device.employee.active) {
    return next(unauthorized('Device not recognised or revoked', 'DEVICE_REVOKED'));
  }

  const message = requestMessage(req.method, req.originalUrl, timestamp, req.rawBody ?? '');
  if (!verifySignature(message, signature, device.publicKey)) {
    return next(unauthorized('Bad device signature', 'DEVICE_AUTH'));
  }

  req.device = { id: device.id, employeeId: device.employeeId, publicKey: device.publicKey };
  next();
}
