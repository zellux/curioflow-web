import { prisma } from "@/server/db";
import { manualUrlSourceId } from "@/server/auth";
import { hashPassword } from "@/server/password";

const MIN_PASSWORD_LENGTH = 8;
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OWNER_ACCOUNT_ID = "account-owner";
const OWNER_USER_ID = "user-owner";
const OWNER_LIBRARY_ID = "library-owner";

export type FirstRunSetupErrorReason =
  | "closed"
  | "invalid-username"
  | "invalid-email"
  | "weak-password";

export async function isFirstRunSetupOpen() {
  const registeredUsers = await prisma.user.count({
    where: { passwordHash: { not: null } }
  });
  return registeredUsers === 0;
}

export async function createFirstRunOwnerAccount(input: {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}) {
  const username = input.username.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const displayName = input.displayName?.trim() || username;

  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false as const, reason: "invalid-username" as FirstRunSetupErrorReason };
  }

  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false as const, reason: "invalid-email" as FirstRunSetupErrorReason };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false as const, reason: "weak-password" as FirstRunSetupErrorReason };
  }

  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const existingUsers = await tx.user.count({
        where: { passwordHash: { not: null } }
      });
      if (existingUsers > 0) {
        return null;
      }

      const account = await tx.account.create({
        data: {
          id: OWNER_ACCOUNT_ID,
          name: displayName
        }
      });

      const createdUser = await tx.user.create({
        data: {
          id: OWNER_USER_ID,
          accountId: account.id,
          username,
          email,
          displayName,
          passwordHash
        }
      });

      const library = await tx.library.create({
        data: {
          id: OWNER_LIBRARY_ID,
          accountId: account.id,
          name: "Personal Library"
        }
      });

      await tx.source.upsert({
        where: { id: manualUrlSourceId(library.id) },
        update: {},
        create: {
          id: manualUrlSourceId(library.id),
          libraryId: library.id,
          type: "url",
          name: "Saved URLs"
        }
      });

      return createdUser;
    });

    if (!user) {
      return { ok: false as const, reason: "closed" as FirstRunSetupErrorReason };
    }

    return { ok: true as const, user };
  } catch (error) {
    // A concurrent first-run request can lose the deterministic owner-record race.
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return { ok: false as const, reason: "closed" as FirstRunSetupErrorReason };
    }
    throw error;
  }
}
