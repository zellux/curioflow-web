import { prisma } from "@/server/db";
import { getCurrentLibrary, manualUrlSourceId } from "@/server/auth";
import { saveArticleItemToLibrary } from "@/server/ingest/articles";

export async function saveUrlToCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  const sourceId = manualUrlSourceId(library.id);
  const source = await prisma.source.upsert({
    where: { id: sourceId },
    update: {},
    create: {
      id: sourceId,
      libraryId: library.id,
      type: "url",
      name: "Saved URLs"
    }
  });

  return saveArticleItemToLibrary({
    libraryId: library.id,
    sourceId: source.id,
    url: inputUrl,
    jobType: "ingest_url"
  });
}
