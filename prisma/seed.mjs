import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const accountId = "account-local";
const userId = "user-local";
const libraryId = "library-local";
const displayName = "Local Reader";

function manualUrlSourceId(id) {
  return id === "default-library" ? "manual-url-source" : `manual-url-source-${id}`;
}

async function main() {
  const account = await prisma.account.upsert({
    where: { id: accountId },
    update: { name: displayName },
    create: {
      id: accountId,
      name: displayName
    }
  });

  await prisma.user.upsert({
    where: { id: userId },
    update: {
      accountId: account.id,
      displayName
    },
    create: {
      id: userId,
      accountId: account.id,
      email: null,
      displayName
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
      name: "Saved URLs",
      status: "active"
    }
  });
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
