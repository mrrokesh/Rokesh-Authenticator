import { env } from './config/env';
import { createApp } from './app';
import { prisma } from './lib/prisma';

async function main() {
  await prisma.$connect();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`MR ROKESH Authenticator API listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  // Mark stale challenges EXPIRED so status polls and dashboards stay accurate.
  const sweeper = setInterval(async () => {
    try {
      await prisma.loginChallenge.updateMany({
        where: { status: 'PENDING', expiresAt: { lte: new Date() } },
        data: { status: 'EXPIRED' },
      });
      await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lte: new Date(Date.now() - 24 * 3600 * 1000) } },
      });
    } catch (err) {
      console.error(`[sweeper] ${(err as Error).message}`);
    }
  }, 30_000);

  const shutdown = async () => {
    clearInterval(sweeper);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (err) => {
  console.error(`Failed to start: ${(err as Error).message}`);
  await prisma.$disconnect();
  process.exit(1);
});
