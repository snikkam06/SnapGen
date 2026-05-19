#!/usr/bin/env node
// Seed N stress-test users with credits and pre-existing assets.
// Writes tests/stress/fixtures/users.json for k6 scenarios to consume.
//
// Usage:
//   node tests/stress/seed-stress-users.mjs                  # defaults: 200 users, 30 assets each
//   STRESS_USER_COUNT=50 STRESS_ASSETS_PER_USER=10 node tests/stress/seed-stress-users.mjs
//   STRESS_CLEAN=true node tests/stress/seed-stress-users.mjs   # delete existing stress users first

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@snapgen/db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const USER_COUNT = Number(process.env.STRESS_USER_COUNT || 200);
const ASSETS_PER_USER = Number(process.env.STRESS_ASSETS_PER_USER || 30);
const CREDITS_PER_USER = Number(process.env.STRESS_CREDITS_PER_USER || 1_000_000);
const CLERK_ID_PREFIX = process.env.STRESS_CLERK_ID_PREFIX || 'stress_user_';
const EMAIL_DOMAIN = process.env.STRESS_EMAIL_DOMAIN || 'stress.local';
const CLEAN = process.env.STRESS_CLEAN === 'true';

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    'DATABASE_URL is not set. Run via the workspace script which wraps with-database-url:\n' +
      '  pnpm --filter @snapgen/stress-tests seed\n' +
      'or set DATABASE_URL yourself before invoking this file directly.',
  );
  process.exit(1);
}

const prisma = new PrismaClient();

async function cleanExistingStressUsers() {
  console.log(`[stress-seed] Cleaning existing stress users (prefix ${CLERK_ID_PREFIX})...`);
  const deleted = await prisma.user.deleteMany({
    where: { clerkUserId: { startsWith: CLERK_ID_PREFIX } },
  });
  console.log(`[stress-seed] Deleted ${deleted.count} existing stress users`);
}

async function seedUser(index) {
  const clerkUserId = `${CLERK_ID_PREFIX}${index.toString().padStart(6, '0')}`;
  const email = `${clerkUserId}@${EMAIL_DOMAIN}`;

  const user = await prisma.user.upsert({
    where: { clerkUserId },
    update: {},
    create: {
      clerkUserId,
      email,
      fullName: `Stress User ${index}`,
      emailVerifiedAt: new Date(),
    },
  });

  // Top up credits to a fixed balance.
  const balance = await prisma.creditLedger.aggregate({
    where: { userId: user.id },
    _sum: { amount: true },
  });
  const currentBalance = balance._sum.amount ?? 0;
  const topUp = CREDITS_PER_USER - currentBalance;
  if (topUp > 0) {
    await prisma.creditLedger.create({
      data: {
        userId: user.id,
        amount: topUp,
        entryType: 'grant',
        reason: 'stress-test seed',
      },
    });
  }

  // Seed assets so GET /assets has work to do (N+1 path).
  const existingAssets = await prisma.asset.count({ where: { userId: user.id } });
  const toCreate = Math.max(0, ASSETS_PER_USER - existingAssets);
  if (toCreate > 0) {
    await prisma.asset.createMany({
      data: Array.from({ length: toCreate }, (_, i) => ({
        userId: user.id,
        kind: 'image',
        storageBucket: 'stress-test',
        storageKey: `stress/${clerkUserId}/${i}.png`,
        mimeType: 'image/png',
        fileSizeBytes: BigInt(1024 * (i + 1)),
        width: 1024,
        height: 1024,
        moderationStatus: 'approved',
        metadataJson: { source: 'stress-seed', index: i },
      })),
    });
  }

  return { clerkUserId, email, dbUserId: user.id };
}

async function main() {
  console.log(`[stress-seed] Target DB: ${new URL(process.env.DATABASE_URL).host}`);
  console.log(
    `[stress-seed] Seeding ${USER_COUNT} users with ${CREDITS_PER_USER} credits and ${ASSETS_PER_USER} assets each`,
  );

  if (CLEAN) {
    await cleanExistingStressUsers();
  }

  const users = [];
  const batchSize = 20;
  for (let i = 0; i < USER_COUNT; i += batchSize) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(batchSize, USER_COUNT - i) }, (_, j) => seedUser(i + j + 1)),
    );
    users.push(...batch);
    process.stdout.write(`  seeded ${users.length}/${USER_COUNT}\r`);
  }
  process.stdout.write('\n');

  const fixturesDir = path.join(__dirname, 'fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });
  const fixturesPath = path.join(fixturesDir, 'users.json');
  fs.writeFileSync(fixturesPath, JSON.stringify(users, null, 2));
  console.log(`[stress-seed] Wrote ${users.length} users to ${path.relative(repoRoot, fixturesPath)}`);
}

main()
  .catch((err) => {
    console.error('[stress-seed] FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
