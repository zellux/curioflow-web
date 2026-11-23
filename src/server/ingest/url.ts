import { prisma } from "@/server/db";
import { getCurrentLibrary, manualUrlSourceId } from "@/server/auth";
import { saveArticleItemToLibrary } from "@/server/ingest/articles";

export async function saveUrlToLibrary(libraryId: string, inputUrl: string, title?: string) {
  const sourceId = manualUrlSourceId(libraryId);
  const source = await prisma.source.upsert({
    where: { id: sourceId },
    update: {},
    create: {
      id: sourceId,
      libraryId,
      type: "url",
      name: "Saved URLs"
    }
  });

  return saveArticleItemToLibrary({
    libraryId,
    sourceId: source.id,
    url: inputUrl,
    title: title?.trim().slice(0, 512)
  });
}

export async function saveUrlToCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  return saveUrlToLibrary(library.id, inputUrl);
}
