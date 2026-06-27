import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";
import { saveArticleItemToLibrary } from "@/server/ingest/articles";

export async function saveUrlToCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  const source = await prisma.source.upsert({
    where: { id: "manual-url-source" },
    update: {},
    create: {
      id: "manual-url-source",
      libraryId: library.id,
      type: "url",
      name: "Saved URLs"
    }
  });

  return saveArticleItemToLibrary({
    libraryId: library.id,
    sourceId: source.id,
    url: inputUrl,
    jobType: "ingest_url",
    allowDuplicateItem: true
  });
}
