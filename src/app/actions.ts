"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveUrlToCurrentLibrary } from "@/server/ingest/url";
import { addRssSourceToCurrentLibrary } from "@/server/ingest/rss";
import { addPodcastSourceToCurrentLibrary } from "@/server/ingest/podcast";
import { savePdfToCurrentLibrary } from "@/server/ingest/pdf";
import { refetchArticleItemContent } from "@/server/ingest/articles";
import { importOpmlFeeds } from "@/server/ingest/opml";
import { askLibrary } from "@/server/chat";
import { enqueueArticleSummaryGeneration, regenerateArticleSummary } from "@/server/summaries";
import { prisma } from "@/server/db";
import { authenticateUser, createSession, destroyCurrentSession, getCurrentAccount, getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { assertEntitlement, canAddSource, canGenerateBrief, canImportOpmlFeeds, canUploadPdf } from "@/server/entitlements";
import { unsubscribeSourceFromCurrentLibrary } from "@/server/sources";
import { upsertLlmSettingsForCurrentAccount } from "@/server/settings";
import { requeueFailedBackgroundJobs } from "@/server/background-jobs";
import { appHref } from "@/app/routes";

function safeReturnTo(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) return "/home";
  return value;
}

export async function loginAction(formData: FormData) {
  const identifier = String(formData.get("identifier") ?? "");
  const password = String(formData.get("password") ?? "");
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  const user = await authenticateUser(identifier, password);

  if (!user) {
    const params = new URLSearchParams({ error: "invalid" });
    if (returnTo !== "/home") params.set("returnTo", returnTo);
    redirect(`/login?${params.toString()}` as Route);
  }

  await createSession(user.id);
  redirect(returnTo as Route);
}

export async function logoutAction() {
  await destroyCurrentSession();
  redirect("/login" as Route);
}

export async function saveUrlAction(formData: FormData) {
  const url = String(formData.get("url") ?? "");
  if (!url.trim()) return;

  const item = await saveUrlToCurrentLibrary(url);
  revalidatePath("/");
  redirect(appHref({ item: item.id }) as Route);
}

export async function addRssSourceAction(formData: FormData) {
  const url = String(formData.get("url") ?? "");
  if (!url.trim()) return;

  let result: Awaited<ReturnType<typeof addRssSourceToCurrentLibrary>>;
  try {
    const account = await getCurrentAccount();
    assertEntitlement(await canAddSource(account));
    result = await addRssSourceToCurrentLibrary(url);
  } catch (error) {
    const params = {
      add: "rss",
      rssPreview: url,
      rssError: error instanceof Error ? error.message : "Unable to subscribe to this feed"
    };
    redirect(appHref(params) as Route);
  }

  revalidatePath("/");
  redirect(result.items[0] ? appHref({ item: result.items[0].id }) as Route : "/");
}

export async function addPodcastSourceAction(formData: FormData) {
  const url = String(formData.get("url") ?? "");
  if (!url.trim()) return;

  let result: Awaited<ReturnType<typeof addPodcastSourceToCurrentLibrary>>;
  try {
    const account = await getCurrentAccount();
    assertEntitlement(await canAddSource(account));
    result = await addPodcastSourceToCurrentLibrary(url);
  } catch (error) {
    const params = {
      add: "podcast",
      podcastUrl: url,
      podcastError: error instanceof Error ? error.message : "Unable to subscribe to this podcast"
    };
    redirect(appHref(params) as Route);
  }

  revalidatePath("/");
  redirect(result.items[0]
    ? appHref({ source: result.source.id, sourceKind: "podcast", item: result.items[0].id }) as Route
    : appHref({ source: result.source.id, sourceKind: "podcast" }) as Route);
}

export async function uploadPdfAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) return;

  let item: Awaited<ReturnType<typeof savePdfToCurrentLibrary>>;
  try {
    const account = await getCurrentAccount();
    assertEntitlement(canUploadPdf(account, file.size));
    item = await savePdfToCurrentLibrary(file);
  } catch (error) {
    redirect(appHref({
      add: "pdf",
      pdfError: error instanceof Error ? error.message : "Unable to upload this PDF"
    }) as Route);
  }

  revalidatePath("/");
  redirect(appHref({ item: item.id }) as Route);
}

export async function importOpmlSourcesAction(formData: FormData) {
  const feedUrls = formData.getAll("feedUrl").map((value) => String(value));
  const feedTitles = formData.getAll("feedTitle").map((value) => String(value));
  const feedHtmlUrls = formData.getAll("feedHtmlUrl").map((value) => String(value));
  const feedCategories = formData.getAll("feedCategory").map((value) => String(value));

  if (feedUrls.length === 0) {
    redirect(appHref({ add: "opml", opmlError: "Select at least one feed to import" }) as Route);
  }

  const account = await getCurrentAccount();
  try {
    assertEntitlement(canImportOpmlFeeds(account, feedUrls.length));
    assertEntitlement(await canAddSource(account, { requestedSources: feedUrls.length }));
  } catch (error) {
    redirect(appHref({
      add: "opml",
      opmlError: error instanceof Error ? error.message : "Unable to import these feeds"
    }) as Route);
  }

  const result = await importOpmlFeeds(
    feedUrls.map((xmlUrl, index) => ({
      xmlUrl,
      title: feedTitles[index] || xmlUrl,
      htmlUrl: feedHtmlUrls[index] || null,
      category: feedCategories[index] || null
    }))
  );
  revalidatePath("/");

  if (result.imported === 0) {
    const error = result.failed[0]?.error ?? "Could not import any feeds from this OPML file";
    const params = {
      add: "opml",
      opmlError: error
    };
    redirect(appHref(params) as Route);
  }

  const params: Record<string, string | undefined> = {
    opmlImported: String(result.imported)
  };
  if (result.failed.length > 0) params.opmlFailed = String(result.failed.length);
  redirect(appHref(params) as Route);
}

export async function unsubscribeSourceAction(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");
  const keepItems = String(formData.get("keepItems") ?? "") === "on";
  if (!sourceId) return;

  await unsubscribeSourceFromCurrentLibrary(sourceId, { keepItems });
  revalidatePath("/");
  redirect("/");
}

export async function retryFailedBackgroundJobsAction() {
  const library = await getCurrentLibrary();
  await requeueFailedBackgroundJobs({ libraryId: library.id });
  revalidatePath("/");
}

export async function askLibraryAction(formData: FormData) {
  const question = String(formData.get("question") ?? "");
  const itemId = String(formData.get("itemId") ?? "") || null;
  const returnView = String(formData.get("returnView") ?? "");

  const thread = await askLibrary(question, itemId);
  revalidatePath("/");
  if (itemId) redirect(`${appHref({ item: itemId, thread: thread.id })}#ask` as Route);
  redirect(returnView === "ask" ? appHref({ view: "ask", thread: thread.id }) as Route : `${appHref({ thread: thread.id })}#ask` as Route);
}

export async function toggleItemSavedAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const savedToLibrary = String(formData.get("savedToLibrary") ?? "") === "true";
  const library = await getCurrentLibrary();

  if (!itemId) return;

  const item = await prisma.item.findFirst({
    where: { id: itemId, libraryId: library.id },
    select: {
      id: true,
      sourceId: true,
      source: { select: { type: true } }
    }
  });

  if (!item) return;

  await prisma.item.updateMany({
    where: { id: itemId, libraryId: library.id },
    data: { savedToLibrary }
  });

  if (savedToLibrary) {
    await enqueueArticleSummaryGeneration({ libraryId: library.id, itemId });
  }

  revalidatePath("/");
  revalidatePath("/recent-posts");
  revalidatePath(`/item/${item.id}`);

  if (item.sourceId) {
    revalidatePath(`/source/${item.sourceId}`);
    if (item.source?.type === "rss") revalidatePath(`/source/feed/${item.sourceId}`);
    if (item.source?.type === "podcast") revalidatePath(`/source/podcast/${item.sourceId}`);
  }
}

export async function archiveItemAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  const library = await getCurrentLibrary();

  if (!itemId) return;

  const item = await prisma.item.findFirst({
    where: { id: itemId, libraryId: library.id },
    select: {
      id: true,
      sourceId: true,
      source: { select: { type: true } }
    }
  });

  if (!item) return;

  await prisma.item.updateMany({
    where: { id: itemId, libraryId: library.id },
    data: { archivedAt: new Date() }
  });

  revalidatePath("/");
  revalidatePath("/archive");
  revalidatePath("/recent-posts");
  revalidatePath(`/item/${item.id}`);

  if (item.sourceId) {
    revalidatePath(`/source/${item.sourceId}`);
    if (item.source?.type === "rss") revalidatePath(`/source/feed/${item.sourceId}`);
    if (item.source?.type === "podcast") revalidatePath(`/source/podcast/${item.sourceId}`);
  }

  if (returnTo.startsWith("/")) redirect(returnTo as Route);
}

export async function unarchiveItemAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const library = await getCurrentLibrary();

  if (!itemId) return;

  const item = await prisma.item.findFirst({
    where: { id: itemId, libraryId: library.id },
    select: {
      id: true,
      sourceId: true,
      source: { select: { type: true } }
    }
  });

  if (!item) return;

  await prisma.item.updateMany({
    where: { id: itemId, libraryId: library.id },
    data: { archivedAt: null }
  });

  revalidatePath("/");
  revalidatePath("/archive");
  revalidatePath("/recent-posts");
  revalidatePath(`/item/${item.id}`);

  if (item.sourceId) {
    revalidatePath(`/source/${item.sourceId}`);
    if (item.source?.type === "rss") revalidatePath(`/source/feed/${item.sourceId}`);
    if (item.source?.type === "podcast") revalidatePath(`/source/podcast/${item.sourceId}`);
  }
}

export async function deleteItemAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  const library = await getCurrentLibrary();

  if (!itemId) return;

  const item = await prisma.item.findFirst({
    where: { id: itemId, libraryId: library.id },
    select: { id: true }
  });

  if (item) {
    await prisma.$transaction([
      prisma.annotation.deleteMany({ where: { itemId: item.id } }),
      prisma.chatThread.updateMany({ where: { itemId: item.id }, data: { itemId: null } }),
      prisma.item.delete({ where: { id: item.id } })
    ]);
  }

  revalidatePath("/");
  redirect(returnTo.startsWith("/") ? (returnTo as Route) : "/");
}

export async function refetchArticleContentAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!itemId) return;

  const library = await getCurrentLibrary();
  const item = await refetchArticleItemContent({ libraryId: library.id, itemId });
  revalidatePath("/");
  const redirectTo = returnTo.startsWith("/") ? returnTo : appHref({ item: itemId });
  const separator = redirectTo.includes("?") ? "&" : "?";
  const result = item.document?.parserVersion === "mock-url-v1" ? "fetch-error" : "article";
  redirect(`${redirectTo}${separator}refetched=${result}` as Route);
}

export async function regenerateArticleSummaryAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!itemId) return;

  const library = await getCurrentLibrary();
  const redirectTo = returnTo.startsWith("/") ? returnTo : appHref({ item: itemId });
  const separator = redirectTo.includes("?") ? "&" : "?";

  try {
    const account = await getCurrentAccount();
    assertEntitlement(canGenerateBrief(account));
    await regenerateArticleSummary({ libraryId: library.id, itemId });
  } catch (error) {
    const reason = error instanceof Error && /api key/i.test(error.message) ? "missing-llm" : "error";
    redirect(`${redirectTo}${separator}summary=${reason}` as Route);
  }

  revalidatePath("/");
  redirect(`${redirectTo}${separator}summary=regenerated` as Route);
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
  redirect(`${appHref({ item: item.id })}#notes` as Route);
}

export async function updateLlmSettingsAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  const baseUrl = String(formData.get("baseUrl") ?? "");
  const model = String(formData.get("model") ?? "");
  const systemLanguage = String(formData.get("systemLanguage") ?? "");
  const summaryLanguage = String(formData.get("summaryLanguage") ?? "");
  const apiKey = String(formData.get("apiKey") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");

  await upsertLlmSettingsForCurrentAccount({
    provider,
    baseUrl,
    model,
    systemLanguage,
    summaryLanguage,
    apiKey
  });

  revalidatePath("/");
  redirect(safeReturnTo(returnTo) as Route);
}
