import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const HASH_PREFIX = "scrypt-v1";

async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${HASH_PREFIX}$${salt}$${Buffer.from(derived).toString("base64url")}`;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function manualUrlSourceId(libraryId) {
  return libraryId === "default-library" ? "manual-url-source" : `manual-url-source-${libraryId}`;
}

async function main() {
  const username = requiredEnv("USERNAME");
  const email = requiredEnv("EMAIL").toLowerCase();
  const password = process.env.PASSWORD || randomBytes(18).toString("base64url");
  const accountId = process.env.ACCOUNT_ID || `account-${username}`;
  const userId = process.env.USER_ID || `user-${username}`;
  const libraryId = process.env.LIBRARY_ID || `library-${username}`;
  const displayName = process.env.DISPLAY_NAME || username;
  const passwordHash = await hashPassword(password);

  const account = await prisma.account.upsert({
    where: { id: accountId },
    update: { name: displayName },
    create: { id: accountId, name: displayName }
  });

  const user = await prisma.user.upsert({
    where: { id: userId },
    update: {
      accountId: account.id,
      username,
      email,
      displayName,
      passwordHash
    },
    create: {
      id: userId,
      accountId: account.id,
      username,
      email,
      displayName,
      passwordHash
    }
  });

  const library = await prisma.library.upsert({
    where: { id: libraryId },
    update: { accountId: account.id, name: "Personal Library" },
    create: {
      id: libraryId,
      accountId: account.id,
      name: "Personal Library"
    }
  });

  await prisma.source.upsert({
    where: { id: manualUrlSourceId(library.id) },
    update: {},
    create: {
      id: manualUrlSourceId(library.id),
      libraryId: library.id,
      type: "url",
      name: "Saved URLs"
    }
  });

  console.log(`username=${user.username}`);
  console.log(`email=${user.email}`);
  console.log(`password=${password}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
