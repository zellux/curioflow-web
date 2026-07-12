import { prisma } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/password";

const MIN_PASSWORD_LENGTH = 8;

export async function changePasswordForUser(userId: string, currentPassword: string, newPassword: string) {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false as const, reason: "weak-password" as const };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true }
  });

  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false as const, reason: "invalid-current-password" as const };
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    return { ok: false as const, reason: "unchanged-password" as const };
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash }
    }),
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now }
    }),
    prisma.authSession.deleteMany({ where: { userId } })
  ]);

  return { ok: true as const };
}
