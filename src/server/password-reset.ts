import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/password";
import { passwordResetEmailConfigured, sendPasswordResetEmail } from "@/server/ses-email";

const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_MINUTES = 45;
const MIN_PASSWORD_LENGTH = 8;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeIdentifier(identifier: string) {
  return identifier.trim();
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function userLookup(identifier: string) {
  const normalized = normalizeIdentifier(identifier);
  const candidates = Array.from(new Set([normalized, normalized.toLowerCase()]));

  return {
    OR: [
      { username: { in: candidates } },
      { email: { in: candidates } }
    ],
    email: { not: null }
  };
}

export function passwordResetEmailReady() {
  return passwordResetEmailConfigured();
}

export async function requestPasswordReset(identifier: string, baseUrl: string) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return;

  const user = await prisma.user.findFirst({
    where: userLookup(normalized),
    select: { id: true, email: true, displayName: true }
  });

  if (!user?.email) return;

  const token = randomBytes(RESET_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt
    }
  });

  const resetUrl = new URL("/reset-password", baseUrl);
  resetUrl.searchParams.set("token", token);

  const safeName = htmlEscape(user.displayName || "Curioflow reader");
  const safeUrl = htmlEscape(resetUrl.toString());

  await sendPasswordResetEmail({
    to: user.email,
    subject: "Reset your Curioflow password",
    text: [
      `Hi ${user.displayName || "there"},`,
      "",
      "Use this link to reset your Curioflow password:",
      resetUrl.toString(),
      "",
      `This link expires in ${RESET_TOKEN_MINUTES} minutes. If you did not request it, you can ignore this email.`
    ].join("\n"),
    html: [
      `<p>Hi ${safeName},</p>`,
      "<p>Use this link to reset your Curioflow password:</p>",
      `<p><a href="${safeUrl}">${safeUrl}</a></p>`,
      `<p>This link expires in ${RESET_TOKEN_MINUTES} minutes. If you did not request it, you can ignore this email.</p>`
    ].join("")
  });
}

export async function resetPasswordWithToken(token: string, password: string) {
  const trimmedToken = token.trim();
  if (!trimmedToken) return { ok: false as const, reason: "invalid-token" as const };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false as const, reason: "weak-password" as const };

  const hashedToken = tokenHash(trimmedToken);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashedToken },
    select: { id: true, userId: true, expiresAt: true, usedAt: true }
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
    return { ok: false as const, reason: "invalid-token" as const };
  }

  const passwordHash = await hashPassword(password);
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash }
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: now }
    }),
    prisma.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
        usedAt: null,
        id: { not: resetToken.id }
      },
      data: { usedAt: now }
    }),
    prisma.authSession.deleteMany({
      where: { userId: resetToken.userId }
    })
  ]);

  return { ok: true as const };
}
