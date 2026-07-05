import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentUser } from "@/server/auth";
import { testConnection, type ConnectionKey } from "@/server/connections";

const CONNECTIONS = new Set<ConnectionKey>(["twitter", "influx"]);

function connectionKey(value: unknown): ConnectionKey | null {
  return typeof value === "string" && CONNECTIONS.has(value as ConnectionKey) ? value as ConnectionKey : null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = connectionKey(body?.key);

  if (!key) {
    return NextResponse.json({ error: "Unknown connection" }, { status: 400 });
  }

  try {
    await requireCurrentUser();
    const result = await testConnection(key);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to test this connection" });
  }
}
