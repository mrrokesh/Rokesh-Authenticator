import { Router } from 'express';
import { requireApiKey, requireAuth, requireRole } from '../middleware/auth';
import { requireDevice } from '../middleware/deviceAuth';
import { validate } from '../middleware/validate';
import { authLimiter, refreshLimiter, deviceLimiter, enrollLimiter, loginRequestLimiter, respondLimiter, totpLimiter } from '../middleware/rateLimit';
import * as auth from '../controllers/authController';
import * as enroll from '../controllers/enrollController';
import * as challenge from '../controllers/challengeController';
import * as device from '../controllers/deviceController';
import * as verify from '../controllers/verifyController';
import * as admin from '../controllers/adminController';

export const api = Router();

/* ---- Dashboard sign-in (password + RS256 JWT, rotating refresh cookie) ---- */
api.post('/auth/login', authLimiter, validate(auth.loginSchema), auth.login);
api.post('/auth/refresh', refreshLimiter, auth.refresh);
api.post('/auth/logout', auth.logout);
api.get('/auth/me', requireAuth, auth.me);

/* ---- Push login approval ---- */
// Company system (X-API-Key) creates a challenge and polls its status.
api.post('/auth/login-request', requireApiKey, loginRequestLimiter, validate(challenge.createLoginRequestSchema), challenge.createLoginRequest);
// Device answers with an Ed25519 signature — registered before the :id route.
api.post('/auth/login-request/respond', respondLimiter, validate(challenge.respondSchema), challenge.respondToLoginRequest);
api.get('/auth/login-request/:id', requireApiKey, challenge.getLoginRequestStatus);

/* ---- Enrollment ---- */
api.post('/enroll/complete', enrollLimiter, validate(enroll.completeEnrollmentSchema), enroll.completeEnrollment);

/* ---- Device (signed requests from the employee app) ---- */
api.get('/device/me', deviceLimiter, requireDevice, device.deviceMe);
api.get('/device/challenges', deviceLimiter, requireDevice, device.listPendingChallenges);
api.get('/device/challenges/:id', deviceLimiter, requireDevice, device.getChallenge);
api.post('/device/push-token', deviceLimiter, requireDevice, validate(device.pushTokenSchema), device.updatePushToken);

/* ---- Code verification for company systems (X-API-Key) ---- */
api.post('/totp/verify', requireApiKey, totpLimiter, validate(verify.totpVerifySchema), verify.verifyTotpCode);
api.post('/recovery/verify', requireApiKey, totpLimiter, validate(verify.recoveryVerifySchema), verify.verifyRecoveryCode);

/* ---- Admin (ADMIN role enforced on every route) ---- */
const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));
adminRouter.get('/employees', validate(admin.listEmployeesQuery, 'query'), admin.listEmployees);
adminRouter.post('/employees', validate(admin.createEmployeeSchema), admin.createEmployee);
adminRouter.patch('/employees/:id', validate(admin.updateEmployeeSchema), admin.updateEmployee);
adminRouter.post('/enrollment-sessions', enrollLimiter, validate(enroll.createSessionSchema), enroll.createEnrollmentSession);
adminRouter.get('/enrollment-sessions/:id', enroll.getEnrollmentSession);
adminRouter.get('/devices', validate(admin.listDevicesQuery, 'query'), admin.listDevices);
adminRouter.post('/revoke-device', validate(admin.revokeDeviceSchema), admin.revokeDevice);
adminRouter.get('/audit-logs', validate(admin.auditQuery, 'query'), admin.listAuditLogs);
api.use('/admin', adminRouter);
