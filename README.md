# MR ROKESH Authenticator

Push-approval + TOTP authenticator for employees.

| Folder | What it is | Run |
|---|---|---|
| `backend/` | Express 5 + TypeScript API, PostgreSQL via Prisma 6 | `npm run dev` (port 4000) |
| `admin-dashboard/` | React + Vite web app: employees, enrollment QR, devices, audit log | `npm run dev` (port 5173) |
| `frontend/` | Expo SDK 57 (React Native) employee app | `npm start` (needs a development build) |

Each folder is independent: its own `package.json`, `node_modules`, and `.env` (copy from `.env.example`).

## How it works

**Enrollment** — the QR is shown on the admin dashboard, never on the phone that scans it.

1. Admin opens *Employees → Enroll device*. The backend creates a 10-minute, single-use `EnrollmentSession` with a new TOTP secret (AES-256-GCM encrypted) and returns a one-time token. Only the token's SHA-256 is stored.
2. The dashboard shows the token as a QR code: `{"t":"mrra-enroll","v":1,"token":"…"}`.
3. The phone scans it with `expo-camera` `CameraView`, creates an Ed25519 keypair from 32 bytes of OS randomness (`expo-crypto`), and stores the seed in `expo-secure-store` (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`).
4. `POST /api/enroll/complete` sends the public key plus a signature over the token (proof of possession). In one transaction the backend claims the session, creates the `Device`, stores 10 bcrypt-hashed recovery codes, and writes an audit row. It returns the TOTP secret and the recovery codes once, over TLS.

**Push login approval**

1. The company system calls `POST /api/auth/login-request` (`X-API-Key`). This creates a `LoginChallenge` with a 32-byte nonce and a 60 s expiry, then sends a push through FCM (Android) or APNs (iOS).
2. The push carries only the challenge id. The app fetches the nonce and details through a **signed** `GET /api/device/challenges/:id`, so no secret ever goes through Google or Apple.
3. Approve needs biometrics or the device passcode. The app signs `mr-rokesh-auth:v1:respond\n{challengeId}\n{nonce}\n{decision}\n{timestamp}` with its Ed25519 key.
4. The backend checks the signature against `device.publicKey`, requires a timestamp within ±60 s, and matches the nonce. It then changes the challenge `PENDING → APPROVED/DENIED` in one atomic update that also requires it to be unexpired. A replayed response gets `409`.
5. The company system polls `GET /api/auth/login-request/:id` until the status is no longer `PENDING`.

The app also polls pending challenges every 5 s while open, so a missed push never blocks a sign-in.

**TOTP** — RFC 6238 (SHA-1, 6 digits, 30 s). The backend uses `otplib`. The app uses the same algorithm built on `@noble/hashes`, because otplib needs Node's `crypto`, which Hermes doesn't have. The two implementations are cross-checked against the RFC 6238 test vectors. Verification accepts ±1 time-step. Each device accepts a given time-step only once, so a code can't be replayed.

## API

```
POST /api/auth/login                      admin/employee password → RS256 access token + httpOnly refresh cookie
POST /api/auth/refresh                    rotates refresh token (reuse ⇒ all sessions revoked)
POST /api/auth/logout
GET  /api/auth/me

POST /api/admin/enrollment-sessions       ADMIN — create session, returns qrPayload
GET  /api/admin/enrollment-sessions/:id   ADMIN — PENDING | COMPLETED | EXPIRED
POST /api/enroll/complete                 device — token + Ed25519 public key + proof signature

POST /api/auth/login-request              X-API-Key — {email, application?, requestIp?}
GET  /api/auth/login-request/:id          X-API-Key — poll status
POST /api/auth/login-request/respond      device — signed approve/deny

GET  /api/device/me                       signed device request
GET  /api/device/challenges[/:id]         signed device request
POST /api/device/push-token               signed device request

POST /api/totp/verify                     X-API-Key — {email, code} → {valid}
POST /api/recovery/verify                 X-API-Key — {email, code} → {valid, remaining}

GET   /api/admin/employees                ADMIN
POST  /api/admin/employees                ADMIN
PATCH /api/admin/employees/:id            ADMIN — name/role/active/password/unlock
GET   /api/admin/devices                  ADMIN
POST  /api/admin/revoke-device            ADMIN
GET   /api/admin/audit-logs               ADMIN — cursor pagination, filter by action/employee
```

A signed device request sends `X-Device-Id`, `X-Device-Timestamp` (unix ms) and `X-Device-Signature`: base64 Ed25519 over
`mr-rokesh-auth:v1:request\n{METHOD}\n{path+query}\n{timestamp}\n{sha256hex(rawBody)}`.

## Local setup

```bash
# 1. Database (or use Supabase/Railway/Neon and skip this)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
npm install
npm run gen:secrets          # paste output into .env (JWT keys, AES key, company API key)
# set ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD in .env
npx prisma migrate deploy
npm run seed:admin           # then remove ADMIN_PASSWORD from .env
npm run dev

# 3. Admin dashboard
cd ../admin-dashboard
cp .env.example .env         # VITE_API_URL=http://localhost:4000
npm install && npm run dev   # http://localhost:5173

# 4. Employee app
cd ../frontend
cp .env.example .env         # EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4000
npm install
npx eas-cli@latest init      # sets EAS_PROJECT_ID
npx eas-cli@latest build --profile development --platform android   # or ios
npm start                    # Metro for the installed development build
```

`npx expo start` in Expo Go is fine for UI work only. **Expo Go cannot receive remote push notifications, and it doesn't include every native module.** Real end-to-end testing needs the EAS development build (`eas build --profile development`).

## Credentials still needed to go fully live

| Credential | Where it goes |
|---|---|
| PostgreSQL connection string | `backend/.env` `DATABASE_URL` |
| RS256 JWT keypair, AES-256 key, company API key | `backend/.env` (generate with `npm run gen:secrets`) |
| Firebase service-account JSON (base64) | `backend/.env` `FIREBASE_SERVICE_ACCOUNT_BASE64`. Never bundled into the app. |
| `google-services.json` (Android app `com.mrrokesh.authenticator`) | `frontend/google-services.json`, or the EAS file env var `GOOGLE_SERVICES_JSON` |
| APNs auth key `.p8` | uploaded through `eas credentials` for the app, **and** in `backend/.env` `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_PRIVATE_KEY_BASE64` |
| Deployed HTTPS backend URL | `frontend/.env` `EXPO_PUBLIC_API_URL`, `admin-dashboard/.env` `VITE_API_URL` |

Until the Firebase/APNs credentials are set, `POST /api/auth/login-request` still creates the challenge. Its response includes `pushDelivered: false, pushError: "not_configured: <VAR>"`, and the employee can still approve from the app's pending list.

For production: set `NODE_ENV=production` and `TRUST_PROXY=1` (or your proxy hop count). The API then rejects non-HTTPS requests, sends HSTS, and uses `SameSite=None; Secure` refresh cookies. Put the dashboard origin in `CORS_ORIGINS`.

## Security properties

- Helmet with strict CSP, CORS restricted to an allowlist, body limit of 32 KB, zod validation on every body and query.
- Rate limits: dashboard login and enrollment per IP. TOTP/recovery verify and login-request per target employee, because those callers are servers.
- Lockout: 5 failed password, TOTP or recovery attempts lock the account for 15 min (`LOCKOUT` audit row). An admin can unlock from the dashboard.
- TOTP secrets are AES-256-GCM encrypted at rest. Recovery codes, refresh tokens and enrollment tokens are stored only as hashes.
- The private key never leaves the phone's secure storage. Android backups are disabled so keys can't be copied to another device.
- A revoked device, or an inactive employee, is rejected on every device-authenticated path, TOTP verification, recovery verification, and challenge creation or response.
- Every admin action and security event writes an `AuditLog` row. Metadata never includes secrets, codes, or keys.
- Security-sensitive writes (enrollment claim, challenge response, recovery code use, revocation, refresh rotation) run in PostgreSQL transactions with conditional `updateMany` claims, so they stay correct under concurrent requests.

## Tests

```bash
cd backend && npm test       # RFC 6238 vectors, ±1 window, AES-GCM tamper, Ed25519 domain separation, recovery codes
```
