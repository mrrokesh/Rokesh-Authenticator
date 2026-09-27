/**
 * Creates (or promotes + resets the password of) the first ADMIN account from
 * ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD in backend/.env.
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || 'Administrator';
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!email) throw new Error('ADMIN_EMAIL is required');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');

  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.employee.upsert({
      where: { email },
      create: { email, name, role: 'ADMIN', passwordHash },
      update: { role: 'ADMIN', passwordHash, active: true, failedAttempts: 0, lockedUntil: null },
    });
    await prisma.auditLog.create({
      data: { employeeId: admin.id, action: 'CREATE_EMPLOYEE', metadata: { via: 'seed:admin', role: 'ADMIN' } },
    });
    console.log(`Admin ready: ${admin.email}. Remove ADMIN_PASSWORD from .env now.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
