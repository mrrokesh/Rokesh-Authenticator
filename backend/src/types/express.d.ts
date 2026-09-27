import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; role: UserRole };
      device?: { id: string; employeeId: string; publicKey: string };
      rawBody?: string;
    }
  }
}

export {};
