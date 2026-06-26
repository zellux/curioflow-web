"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveUrlToCurrentLibrary } from "@/server/ingest/url";
import { addRssSourceToCurrentLibrary } from "@/server/ingest/rss";
import { prisma } from "@/server/db";
import { getCurrentLibrary } from "@/server/auth";

export async function saveUrlAction(formData: FormData) {
  const url = String(formData.get("url") ?? "");
  if (!url.trim()) return;

  const item = await saveUrlToCurrentLibrary(url);
  revalidatePath("/");
  redirect(`/?item=${item.id}`);
}

export async function addRssSourceAction(formData: FormData) {
  const url = String(formData.get("url") ?? "");
  if (!url.trim()) return;

  const result = await addRssSourceToCurrentLibrary(url);
  revalidatePath("/");
  redirect(result.items[0] ? `/?item=${result.items[0].id}` : "/");
}

export async function updateReadStatusAction(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  const readStatus = String(formData.get("readStatus") ?? "unread");
  const library = await getCurrentLibrary();

  if (!["unread", "reading", "done"].includes(readStatus)) return;

  await prisma.item.updateMany({
    where: { id: itemId, libraryId: library.id },
    data: { readStatus }
  });

  revalidatePath("/");
}
