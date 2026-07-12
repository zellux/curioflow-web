import type { Prisma } from "@prisma/client";
import { prisma } from "./db.ts";
import { EntitlementDeniedError } from "./entitlement-limits.ts";

const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MONTHLY_USAGE_LIMIT = 1_000_000_000;

function positiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function managedUsageLimit(
  eventType: string,
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  const eventKey = eventType.replaceAll(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  return positiveInt(env[`CURIOFLOW_MONTHLY_${eventKey}_LIMIT`], DEFAULT_MONTHLY_USAGE_LIMIT);
}

function startOfUtcMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function reserveManagedUsage(input: {
  accountId: string;
  eventType: string;
  idempotencyKey: string;
  quantity?: number;
}) {
  const quantity = Math.max(1, Math.floor(input.quantity ?? 1));
  const limit = managedUsageLimit(input.eventType);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.usageReservation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.accountId !== input.accountId || existing.eventType !== input.eventType) {
        throw new Error("Usage reservation idempotency key belongs to a different operation");
      }
      if (existing.status === "consumed") return existing;
      if (existing.status === "reserved" && existing.expiresAt > now) return existing;
    }

    await tx.account.update({
      where: { id: input.accountId },
      data: { quotaVersion: { increment: 1 } }
    });
    await tx.usageReservation.updateMany({
      where: { accountId: input.accountId, eventType: input.eventType, status: "reserved", expiresAt: { lte: now } },
      data: { status: "released" }
    });
    const [consumed, reserved] = await Promise.all([
      tx.usageEvent.aggregate({
        where: { accountId: input.accountId, eventType: input.eventType, createdAt: { gte: startOfUtcMonth(now) } },
        _sum: { quantity: true }
      }),
      tx.usageReservation.aggregate({
        where: { accountId: input.accountId, eventType: input.eventType, status: "reserved", expiresAt: { gt: now } },
        _sum: { quantity: true }
      })
    ]);
    const used = (consumed._sum.quantity ?? 0) + (reserved._sum.quantity ?? 0);
    if (used + quantity > limit) {
      throw new EntitlementDeniedError({
        allowed: false,
        code: "managed_usage_quota_exceeded",
        reason: `Monthly ${input.eventType.replaceAll("_", " ")} quota reached for this account.`
      });
    }

    const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
    if (existing) {
      return tx.usageReservation.update({
        where: { id: existing.id },
        data: { status: "reserved", quantity, expiresAt }
      });
    }
    return tx.usageReservation.create({
      data: { accountId: input.accountId, eventType: input.eventType, idempotencyKey: input.idempotencyKey, quantity, expiresAt }
    });
  });
}

export async function consumeManagedUsageInTransaction(tx: Prisma.TransactionClient, reservationId: string) {
  const reservation = await tx.usageReservation.findUnique({ where: { id: reservationId } });
  if (!reservation || reservation.status === "consumed") return;
  const updated = await tx.usageReservation.updateMany({
    where: { id: reservation.id, status: "reserved" },
    data: { status: "consumed" }
  });
  if (updated.count === 0) return;
  await tx.usageEvent.create({
    data: {
      accountId: reservation.accountId,
      eventType: reservation.eventType,
      quantity: reservation.quantity,
      metadataJson: JSON.stringify({ usageReservationId: reservation.id })
    }
  });
}

export async function consumeManagedUsage(reservationId: string) {
  await prisma.$transaction((tx) => consumeManagedUsageInTransaction(tx, reservationId));
}

export async function releaseManagedUsage(reservationId: string | null | undefined) {
  if (!reservationId) return;
  await prisma.usageReservation.updateMany({
    where: { id: reservationId, status: "reserved" },
    data: { status: "released" }
  });
}
