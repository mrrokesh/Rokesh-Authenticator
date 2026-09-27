import 'dotenv/config';
import { z } from 'zod';

const pem = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .min(1, `${name} is required`)
    .transform((v) => v.replace(/\\n/g, '\n'));

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGINS: z
    .string()
    .min(1, 'CORS_ORIGINS is required')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  JWT_PRIVATE_KEY: pem('JWT_PRIVATE_KEY'),
  JWT_PUBLIC_KEY: pem('JWT_PUBLIC_KEY'),
  JWT_ISSUER: z.string().default('mr-rokesh-authenticator'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  TOTP_ENCRYPTION_KEY: z
    .string()
    .min(1, 'TOTP_ENCRYPTION_KEY is required')
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'TOTP_ENCRYPTION_KEY must be 32 bytes, base64 encoded'),
  COMPANY_API_KEY: z.string().min(32, 'COMPANY_API_KEY must be at least 32 characters'),
  TOTP_ISSUER: z.string().default('MR ROKESH'),

  LOGIN_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  ENROLLMENT_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional().default(''),

  APNS_KEY_ID: z.string().optional().default(''),
  APNS_TEAM_ID: z.string().optional().default(''),
  APNS_PRIVATE_KEY_BASE64: z.string().optional().default(''),
  APNS_BUNDLE_ID: z.string().optional().default(''),
  APNS_USE_SANDBOX: bool,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print variable names and problems only — never values.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid backend environment configuration:\n${issues}\nSee backend/.env.example`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
