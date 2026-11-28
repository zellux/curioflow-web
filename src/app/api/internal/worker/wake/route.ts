import { NextResponse } from "next/server";
import { startQueuedBackgroundJobs, wakeQueuedBackgroundJob } from "@/server/background-jobs";
import { backgroundWorkRunsHere } from "@/server/worker-runtime";
import { verifyWorkerWakeToken, WORKER_WAKE_HEADER } from "@/server/worker-wake";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!backgroundWorkRunsHere()) {
    return NextResponse.json({ error: "Worker not enabled on this instance" }, { status: 404 });
  }

  if (!verifyWorkerWakeToken(request.headers.get(WORKER_WAKE_HEADER))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    jobId?: unknown;
    libraryId?: unknown;
    interactive?: unknown;
  } | null;

  const jobId = typeof body?.jobId === "string" && body.jobId.trim() ? body.jobId.trim() : null;
  const libraryId = typeof body?.libraryId === "string" && body.libraryId.trim() ? body.libraryId.trim() : undefined;
  const interactiveOnly = body?.interactive === true;

  if (jobId) {
    const started = await wakeQueuedBackgroundJob(jobId);
    if (started) {
      return NextResponse.json({ ok: true, started: 1 });
    }
  }

  const result = await startQueuedBackgroundJobs({ libraryId, interactiveOnly });
  return NextResponse.json({ ok: true, started: result.started });
}
