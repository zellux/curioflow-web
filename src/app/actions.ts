"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveUrlToCurrentLibrary } from "@/server/ingest/url";
import { addRssSourceToCurrentLibrary } from "@/server/ingest/rss";
import { addPodcastSourceToCurrentLibrary } from "@/server/ingest/podcast";
import { savePdfToCurrentLibrary } from "@/server/ingest/pdf";
import { askLibrary } from "@/server/chat";
import { prisma } from "@/server/db";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { unsubscribeSourceFromCurrentLibrary } from "@/server/sources";
import { upsertLlmSettingsForCurrentAccount } from "@/server/settings";

export async function saveUrlAction(formData: FormData) {
  const url = String(formData.get("url") ?? "");
  if (!url.trim()) return;

  const item = await saveUrlToCurrentLibrary(url);
  revalidatePath("/");
  redirect(`/?item=${item.id}`);
}

export async function addRssSourceAction(formData: FormData) {
  const url = String(formData.get("url") ?? "");
  const style = String(formData.get("style") ?? "");
  if (!url.trim()) return;

  let result: Awaited<ReturnType<typeof addRssSourceToCurrentLibrary>>;
  try {
    result = await addRssSourceToCurrentLibrary(url);
  } catch (error) {
    const params = new URLSearchParams({
      add: "rss",
      rssPreview: url,
      rssError: error instanceof Error ? error.message : "Unable to subscribe to this feed"
    });
    if (style) params.set("style", style);
    redirect(`/?${params.toString()}`);
  }

  revalidatePath("/");
  redirect(result.items[0] ? `/?item=${result.items[0].id}` : "/");
}

export async function addPodcastSourceAction(formData: FormData) {
  const url = String(formData.get("url") ?? "");
  const style = String(formData.get("style") ?? "");
  if (!url.trim()) return;

  let result: Awaited<ReturnType<typeof addPodcastSourceToCurrentLibrary>>;
  try {
    result = await addPodcastSourceToCurrentLibrary(url);
  } catch (error) {
    const params = new URLSearchParams({
      add: "podcast",
      podcastUrl: url,
      podcastError: error instanceof Error ? error.message : "Unable to subscribe to this podcast"
    });
    if (style) params.set("style", style);
    redirect(`/?${params.toString()}`);
  }

  revalidatePath("/");
  redirect(result.items[0] ? `/?source=${result.source.id}&item=${result.items[0].id}` : `/?source=${result.source.id}`);
}

export async function uploadPdfAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) return;

  const item = await savePdfToCurrentLibrary(file);
  revalidatePath("/");
  redirect(`/?item=${item.id}`);
}

export async function unsubscribeSourceAction(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");
  const keepItems = String(formData.get("keepItems") ?? "") === "on";
  if (!sourceId) return;

  await unsubscribeSourceFromCurrentLibrary(sourceId, { keepItems });
  revalidatePath("/");
  redirect("/");
}

export async function askLibraryAction(formData: FormData) {
  const question = String(formData.get("question") ?? "");
  const itemId = String(formData.get("itemId") ?? "") || null;
  const returnView = String(formData.get("returnView") ?? "");

  const thread = await askLibrary(question, itemId);
  revalidatePath("/");
  if (itemId) redirect(`/?item=${itemId}&thread=${thread.id}#ask`);
  redirect(returnView === "ask" ? `/?view=ask&thread=${thread.id}` : `/?thread=${thread.id}#ask`);
}

export async function updateReadStatusAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const readStatus = String(formData.get("readStatus") ?? "unread");
  const library = await getCurrentLibrary();

  if (!["unread", "reading", "done"].includes(readStatus)) return;

  await prisma.item.updateMany({
    where: { id: itemId, libraryId: library.id },
    data: {
      readStatus,
      lastReadAt: new Date(),
      ...(readStatus === "done" ? { readingProgress: 1 } : {})
    }
  });

  revalidatePath("/");
}

export async function toggleItemSavedAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const savedToLibrary = String(formData.get("savedToLibrary") ?? "") === "true";
  const library = await getCurrentLibrary();

  if (!itemId) return;

  await prisma.item.updateMany({
    where: { id: itemId, libraryId: library.id },
    data: { savedToLibrary }
  });

  revalidatePath("/");
}

export async function createAnnotationAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const quote = String(formData.get("quote") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const [library, user] = await Promise.all([getCurrentLibrary(), getCurrentUser()]);

  if (!itemId || !quote) return;

  const item = await prisma.item.findFirst({
    where: { id: itemId, libraryId: library.id },
    select: { id: true, documentId: true }
  });

  if (!item?.documentId) return;

  await prisma.annotation.create({
    data: {
      userId: user.id,
      itemId: item.id,
      documentId: item.documentId,
      quote,
      note: note || null
    }
  });

  revalidatePath("/");
  redirect(`/?item=${item.id}#notes`);
}

export async function updateLlmSettingsAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  const baseUrl = String(formData.get("baseUrl") ?? "");
  const model = String(formData.get("model") ?? "");
  const apiKey = String(formData.get("apiKey") ?? "");

  await upsertLlmSettingsForCurrentAccount({
    provider,
    baseUrl,
    model,
    apiKey
  });

  revalidatePath("/");
  redirect("/?view=settings&saved=llm");
}
