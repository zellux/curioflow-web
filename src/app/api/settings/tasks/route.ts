import { NextResponse } from "next/server";
import { requireCurrentLibrary } from "@/server/auth";
import { apiErrorResponse } from "@/server/api-errors";
import { getTaskMonitor, retryMonitoredJob, type TaskFilter } from "@/server/task-monitor";

export async function GET(request: Request) {
  try {
    const library = await requireCurrentLibrary();
    const filter = new URL(request.url).searchParams.get("status") ?? "all";
    if (!["all", "queued", "running", "failed", "succeeded"].includes(filter)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    return NextResponse.json(await getTaskMonitor(library.id, filter as TaskFilter), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load background tasks" });
  }
}

export async function POST(request: Request) {
  try {
    const library = await requireCurrentLibrary();
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "JSON required" }, { status: 415 });
    }
    const body = await request.json().catch(() => null) as { jobId?: unknown } | null;
    if (typeof body?.jobId !== "string" || body.jobId.length > 200) {
      return NextResponse.json({ error: "Invalid job" }, { status: 400 });
    }
    const result = await retryMonitoredJob(library.id, body.jobId);
    return NextResponse.json({ result }, { status: result === "queued" ? 200 : result === "not_found" ? 404 : 409 });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to retry this task" });
  }
}
