import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/password";

export const DEFAULT_ACCOUNT_ID = "default-account";
export const DEFAULT_USER_ID = "default-user";
export const DEFAULT_LIBRARY_ID = "default-library";
export const SESSION_COOKIE_NAME = "curioflow_session";

const SESSION_DAYS = 30;

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

function sessionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function manualSourceId(kind: "pdf" | "url", libraryId: string) {
  const legacyId = kind === "pdf" ? "manual-pdf-source" : "manual-url-source";
  return libraryId === DEFAULT_LIBRARY_ID ? legacyId : `${legacyId}-${libraryId}`;
}

export function manualUrlSourceId(libraryId: string) {
  return manualSourceId("url", libraryId);
}

export function manualPdfSourceId(libraryId: string) {
  return manualSourceId("pdf", libraryId);
}

export async function ensureDefaultWorkspace() {
  const account = await prisma.account.upsert({
    where: { id: DEFAULT_ACCOUNT_ID },
    update: {},
    create: { id: DEFAULT_ACCOUNT_ID, name: "Personal" }
  });

  const user = await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: {
      id: DEFAULT_USER_ID,
      accountId: account.id,
      displayName: "Default User"
    }
  });

  const library = await prisma.library.upsert({
    where: { id: DEFAULT_LIBRARY_ID },
    update: {},
    create: {
      id: DEFAULT_LIBRARY_ID,
      accountId: account.id,
      name: "Default Library"
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

  return { account, user, library };
}

export async function authenticateUser(identifier: string, password: string) {
  const normalized = identifier.trim();
  if (!normalized || !password) return null;

  const candidates = Array.from(new Set([normalized, normalized.toLowerCase()]));
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { in: candidates } },
        { email: { in: candidates } }
      ],
      passwordHash: { not: null }
    }
  });

  if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
  return user;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: sessionTokenHash(token),
      expiresAt
    }
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt
  });
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.authSession.deleteMany({
      where: { tokenHash: sessionTokenHash(token) }
    });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

export async function getAuthenticatedUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: sessionTokenHash(token) },
    include: { user: true }
  });

  if (!session || session.expiresAt <= new Date()) {
    if (session) {
      await prisma.authSession.delete({ where: { id: session.id } });
    }
    return null;
  }

  return session.user;
}

export async function requireCurrentUser() {
  const user = await getAuthenticatedUser();
  if (!user) throw new AuthRequiredError();
  return user;
}

export async function getCurrentUser() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  return user;
}

async function getOrCreateLibraryForAccount(accountId: string) {
  let library = await prisma.library.findFirst({
    where: { accountId },
    orderBy: { createdAt: "asc" }
  });

  if (!library) {
    library = await prisma.library.create({
      data: {
        accountId,
        name: "Personal Library"
      }
    });
  }

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

  return library;
}

export async function requireCurrentAccount() {
  const user = await requireCurrentUser();
  return prisma.account.findUniqueOrThrow({ where: { id: user.accountId } });
}

export async function requireCurrentLibrary() {
  const user = await requireCurrentUser();
  return getOrCreateLibraryForAccount(user.accountId);
}

export async function getCurrentAccount() {
  const user = await getCurrentUser();
  return prisma.account.findUniqueOrThrow({ where: { id: user.accountId } });
}

export async function getCurrentLibrary() {
  const user = await getCurrentUser();
  return getOrCreateLibraryForAccount(user.accountId);
}
