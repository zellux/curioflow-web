import { NextResponse } from "next/server";
import {
  authenticateUser,
  createSession,
  destroyCurrentSession,
  getAuthenticatedUser,
  getCurrentLibrary
} from "@/server/auth";
import { authThrottleStatus, delayAfterFailedAuth, requestIpAddress, resetAuthThrottle } from "@/server/auth-rate-limit";
import { mobileProtocolMetadata } from "@/server/mobile-protocol";

export async function GET() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({
      code: "authentication_required",
      message: "Authentication required",
      retryable: false,
      protocol: mobileProtocolMetadata()
    }, { status: 401 });
  }

  const library = await getCurrentLibrary();
  return NextResponse.json({
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      email: user.email
    },
    library: {
      id: library.id,
      name: library.name
    },
    protocol: mobileProtocolMetadata()
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    identifier?: string;
    password?: string;
  } | null;

  if (!body?.identifier || !body.password) {
    return NextResponse.json({
      code: "invalid_credentials_payload",
      message: "identifier and password are required",
      retryable: false
    }, { status: 400 });
  }

  const ipAddress = requestIpAddress(request.headers);
  const throttle = await authThrottleStatus(body.identifier, ipAddress);
  if (!throttle.allowed) {
    return NextResponse.json(
      { code: "authentication_throttled", message: "Too many login attempts. Try again later.", retryable: true },
      {
        status: 429,
        headers: { "retry-after": String(throttle.retryAfterSeconds) }
      }
    );
  }

  const user = await authenticateUser(body.identifier, body.password);
  if (!user) {
    await delayAfterFailedAuth(body.identifier, ipAddress);
    return NextResponse.json({ code: "invalid_credentials", message: "Invalid username or password", retryable: false }, { status: 401 });
  }

  await resetAuthThrottle(body.identifier, ipAddress);
  await createSession(user.id);
  const library = await getCurrentLibrary();

  return NextResponse.json({
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username,
      email: user.email
    },
    library: {
      id: library.id,
      name: library.name
    },
    protocol: mobileProtocolMetadata()
  });
}

export async function DELETE() {
  await destroyCurrentSession();
  return NextResponse.json({ ok: true });
}
