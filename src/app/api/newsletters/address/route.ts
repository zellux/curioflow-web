import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/server/api-errors";
import { requireCurrentLibrary, requireCurrentUser } from "@/server/auth";
import {
  getNewsletterAddressForAccount,
  getOrCreateNewsletterAddress,
  newsletterInboxCapability
} from "@/server/newsletter-address";

export async function GET() {
  try {
    const user = await requireCurrentUser();
    const capability = newsletterInboxCapability();
    const inbox = await getNewsletterAddressForAccount(user.accountId);
    return NextResponse.json({
      enabled: capability.enabled,
      address: inbox?.status === "active" ? inbox.address : null
    });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to load newsletter address" });
  }
}

export async function POST() {
  try {
    const [user, library] = await Promise.all([requireCurrentUser(), requireCurrentLibrary()]);
    const capability = newsletterInboxCapability();
    if (!capability.enabled) {
      return NextResponse.json({ error: "Newsletter inbox is not configured on this server" }, { status: 503 });
    }
    const inbox = await getOrCreateNewsletterAddress({
      accountId: user.accountId,
      displayName: user.displayName,
      libraryId: library.id
    });
    return NextResponse.json({ enabled: true, address: inbox.address }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, { fallbackMessage: "Unable to create newsletter address" });
  }
}
