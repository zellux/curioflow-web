import { NextResponse } from "next/server";
import { requireCurrentAccount } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { enqueueAccountExport, issueAccountExportDownloads } from "@/server/account-exports";
import { prisma } from "@/server/db";

function serialize(accountExport: Awaited<ReturnType<typeof prisma.accountExport.findFirst>>) {
  if (!accountExport) return null;
  return {
    id: accountExport.id,
    status: accountExport.status,
    error: accountExport.error,
    requestedAt: accountExport.requestedAt.toISOString(),
    completedAt: accountExport.completedAt?.toISOString() ?? null,
    retainedUntil: accountExport.retainedUntil?.toISOString() ?? null,
    downloadedAt: accountExport.downloadedAt?.toISOString() ?? null
  };
}

export async function POST() {
  try {
    const account = await requireCurrentAccount();
    const accountExport = await enqueueAccountExport(account.id);
    return NextResponse.json({ export: serialize(accountExport) }, { status: accountExport.status === "queued" ? 202 : 200 });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to request account export" });
  }
}

export async function GET(request: Request) {
  try {
    const account = await requireCurrentAccount();
    const url = new URL(request.url);
    const exportId = url.searchParams.get("id");
    const accountExport = await prisma.accountExport.findFirst({
      where: { accountId: account.id, ...(exportId ? { id: exportId } : {}) },
      orderBy: { requestedAt: "desc" }
    });
    if (!accountExport) return NextResponse.json({ error: "Export not found" }, { status: 404 });
    const downloads = accountExport.status === "ready"
      ? await issueAccountExportDownloads(account.id, accountExport.id)
      : null;
    return NextResponse.json({ export: serialize(accountExport), downloads });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to read account export" });
  }
}
