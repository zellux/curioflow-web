import { prisma } from "@/server/db";
import { getCurrentLibrary, manualUrlSourceId } from "@/server/auth";
import { saveArticleItemWithStatus } from "@/server/ingest/articles";

export async function saveUrlToLibrary(libraryId: string, inputUrl: string, title?: string) {
  const { item } = await saveUrlWithStatus(libraryId, inputUrl, title);
  return item;
}

export async function saveUrlWithStatus(libraryId: string, inputUrl: string, title?: string) {
  const cleanTitle = title?.trim().slice(0, 512);
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

  return saveArticleItemWithStatus({
    libraryId,
    sourceId: source.id,
    url: inputUrl,
    title: cleanTitle
  });
}

export async function saveUrlToCurrentLibrary(inputUrl: string) {
  const library = await getCurrentLibrary();
  return saveUrlToLibrary(library.id, inputUrl);
}
