import { NextResponse } from "next/server";
import { AuthRequiredError } from "@/server/auth";
import { EntitlementDeniedError } from "@/server/entitlements";
import { applyMobileSyncUpdates, getMobileSyncPayload } from "@/server/mobile";
import { recordMobileSyncMetrics } from "@/server/monitoring";
import {
  MAX_MOBILE_MUTATIONS_PER_REQUEST,
  mobileMutationBatchValidationError,
  type MobileItemUpdate
} from "@/server/mobile-sync-state";

function mobileErrorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (error instanceof EntitlementDeniedError) {
    return NextResponse.json({ code: error.code, message: error.message, retryable: false }, { status: error.status });
  }

  throw error;
}

export async function GET(request: Request) {
  try {
    const payload = await getMobileSyncPayload(request.url);
    recordMobileSyncMetrics("get");
    return NextResponse.json(payload);
  } catch (error) {
    return mobileErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    annotationMutations?: import("@/server/mobile").MobileAnnotationMutation[];
    deviceId?: string;
    itemUpdates?: MobileItemUpdate[];
    readingSettings?: {
      theme?: string;
      font?: string;
      colorMode?: string;
      fontScale?: number;
    };
  } | null;

  if (!body || (!Array.isArray(body.itemUpdates) && !Array.isArray(body.annotationMutations) && !body.readingSettings)) {
    return NextResponse.json({ error: "itemUpdates, annotationMutations, or readingSettings is required" }, { status: 400 });
  }

  const batchError = mobileMutationBatchValidationError(body.itemUpdates ?? []);
  if (batchError) {
    return NextResponse.json(
      { code: "mobile_sync_batch_too_large", error: batchError },
      { status: 400 }
    );
  }
  if ((body.itemUpdates?.length ?? 0) + (body.annotationMutations?.length ?? 0) > MAX_MOBILE_MUTATIONS_PER_REQUEST) {
    return NextResponse.json(
      { code: "mobile_sync_batch_too_large", error: `A sync request must contain at most ${MAX_MOBILE_MUTATIONS_PER_REQUEST} mutations` },
      { status: 400 }
    );
  }

  try {
    const payload = await applyMobileSyncUpdates({
      deviceId: body.deviceId,
      annotationMutations: body.annotationMutations,
      itemUpdates: body.itemUpdates,
      readingSettings: body.readingSettings
    });
    recordMobileSyncMetrics("post", (body.itemUpdates?.length ?? 0) + (body.annotationMutations?.length ?? 0));
    return NextResponse.json(payload);
  } catch (error) {
    return mobileErrorResponse(error);
  }
}
