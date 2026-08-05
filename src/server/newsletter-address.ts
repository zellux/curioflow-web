import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { newsletterInboundConfiguration } from "@/server/newsletter-inbound-config";

function addressPrefix(value: string) {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return normalized || "reader";
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function newsletterInboxCapability() {
  const configuration = newsletterInboundConfiguration();
  return { enabled: configuration.enabled, domain: configuration.domain };
}

export async function getNewsletterAddressForAccount(accountId: string) {
  return prisma.newsletterAddress.findUnique({ where: { accountId } });
}

export async function getOrCreateNewsletterAddress(input: {
  accountId: string;
  displayName: string;
  libraryId: string;
}) {
  const configuration = newsletterInboundConfiguration();
  const domain = configuration.domain;
  if (!configuration.enabled || !domain) throw new Error("Newsletter inbox is not configured on this server");

  const existing = await getNewsletterAddressForAccount(input.accountId);
  if (existing) return existing;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = randomBytes(6).toString("base64url").toLowerCase();
    const address = `${addressPrefix(input.displayName)}.${token}@${domain}`;
    try {
      return await prisma.newsletterAddress.create({
        data: {
          accountId: input.accountId,
          libraryId: input.libraryId,
          address,
          tokenHash: tokenHash(token)
        }
      });
    } catch (error) {
      const racedAddress = await getNewsletterAddressForAccount(input.accountId);
      if (racedAddress) return racedAddress;
      if (attempt === 4) throw error;
    }
  }

  throw new Error("Unable to allocate newsletter address");
}
