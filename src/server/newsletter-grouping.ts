export const NEWSLETTER_IDENTITY_KIND = {
  FROM_ADDRESS: "from_address",
  LIST_ID: "list_id"
} as const;

export type NewsletterIdentityKind = typeof NEWSLETTER_IDENTITY_KIND[keyof typeof NEWSLETTER_IDENTITY_KIND];

export type NewsletterGroupingIdentity = {
  blocked: boolean;
  kind: NewsletterIdentityKind;
  value: string;
};

export type NewsletterGroupingSource = {
  id: string;
  identities: NewsletterGroupingIdentity[];
  status: string;
};

export type NewsletterGroupingEvidence = {
  authenticatedFrom: boolean;
  fromAddress?: string | null;
  listId?: string | null;
};

export type NewsletterGroupingDecision =
  | { action: "blocked"; confidence: "high" | "medium"; reason: string; sourceId: string }
  | { action: "match"; confidence: "high" | "medium"; promote: boolean; reason: string; sourceId: string }
  | { action: "provisional"; confidence: "low" | "unknown"; reason: string; suggestedSourceIds: string[] };

function uniqueSources(sources: NewsletterGroupingSource[]) {
  return Array.from(new Map(sources.map((source) => [source.id, source])).values());
}

function sourcesWithIdentity(
  sources: NewsletterGroupingSource[],
  kind: NewsletterIdentityKind,
  value: string
) {
  return uniqueSources(sources.filter((source) => source.identities.some((identity) => (
    identity.kind === kind && identity.value === value
  ))));
}

function matchingIdentity(source: NewsletterGroupingSource, kind: NewsletterIdentityKind, value: string) {
  return source.identities.find((identity) => identity.kind === kind && identity.value === value);
}

export function normalizeNewsletterListId(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const bracketed = trimmed.match(/<\s*([^<>]+?)\s*>/);
  const identifier = (bracketed?.[1] ?? trimmed).trim().toLowerCase();
  return identifier || null;
}

export function newsletterListDescription(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const bracketIndex = trimmed.lastIndexOf("<");
  if (bracketIndex <= 0) return null;
  const description = trimmed.slice(0, bracketIndex).trim().replace(/^(["'])|(["'])$/g, "").trim();
  return description || null;
}

export function normalizeNewsletterEmailAddress(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const bracketed = trimmed.match(/<\s*([^<>]+?)\s*>/);
  const address = (bracketed?.[1] ?? trimmed).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return null;
  const [localPart, domain] = address.split("@");
  return `${localPart}@${domain.toLowerCase()}`;
}

export function newsletterSenderDomain(value: string | null | undefined) {
  const address = normalizeNewsletterEmailAddress(value);
  return address?.split("@")[1] ?? null;
}

export function newsletterSourceName(input: {
  fromAddress?: string | null;
  fromName?: string | null;
  listIdHeader?: string | null;
}) {
  return newsletterListDescription(input.listIdHeader)
    ?? input.fromName?.trim()
    ?? newsletterSenderDomain(input.fromAddress)
    ?? "Unknown newsletter";
}

export function decideNewsletterGrouping(
  evidence: NewsletterGroupingEvidence,
  sources: NewsletterGroupingSource[]
): NewsletterGroupingDecision {
  const listId = normalizeNewsletterListId(evidence.listId);
  const fromAddress = normalizeNewsletterEmailAddress(evidence.fromAddress);

  if (listId) {
    if (!evidence.authenticatedFrom) {
      return { action: "provisional", confidence: "low", reason: "unauthenticated-list-id", suggestedSourceIds: [] };
    }
    const listMatches = sourcesWithIdentity(sources, NEWSLETTER_IDENTITY_KIND.LIST_ID, listId);
    if (listMatches.length === 1) {
      const source = listMatches[0];
      const identity = matchingIdentity(source, NEWSLETTER_IDENTITY_KIND.LIST_ID, listId);
      if (identity?.blocked || source.status === "blocked") {
        return { action: "blocked", confidence: "high", reason: "blocked-list-id", sourceId: source.id };
      }
      return { action: "match", confidence: "high", promote: source.status === "provisional", reason: "exact-list-id", sourceId: source.id };
    }
    if (listMatches.length > 1) {
      return {
        action: "provisional",
        confidence: "low",
        reason: "ambiguous-list-id",
        suggestedSourceIds: listMatches.map((source) => source.id)
      };
    }

    if (fromAddress) {
      const fromMatches = sourcesWithIdentity(sources, NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS, fromAddress);
      const promotable = fromMatches.filter((source) => (
        source.status === "provisional"
        && !source.identities.some((identity) => identity.kind === NEWSLETTER_IDENTITY_KIND.LIST_ID)
      ));
      if (fromMatches.length === 1 && promotable.length === 1) {
        const identity = matchingIdentity(promotable[0], NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS, fromAddress);
        if (identity?.blocked || promotable[0].status === "blocked") {
          return { action: "blocked", confidence: "medium", reason: "blocked-from-address", sourceId: promotable[0].id };
        }
        return { action: "match", confidence: "high", promote: true, reason: "new-list-id-for-provisional-sender", sourceId: promotable[0].id };
      }
      if (fromMatches.length > 0) {
        return {
          action: "provisional",
          confidence: "low",
          reason: "new-list-id-conflicts-with-sender-history",
          suggestedSourceIds: fromMatches.map((source) => source.id)
        };
      }
    }

    return { action: "provisional", confidence: "unknown", reason: "new-list-id", suggestedSourceIds: [] };
  }

  if (fromAddress && evidence.authenticatedFrom) {
    const fromMatches = sourcesWithIdentity(sources, NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS, fromAddress);
    if (fromMatches.length === 1) {
      const source = fromMatches[0];
      const identity = matchingIdentity(source, NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS, fromAddress);
      if (identity?.blocked || source.status === "blocked") {
        return { action: "blocked", confidence: "medium", reason: "blocked-from-address", sourceId: source.id };
      }
      return { action: "match", confidence: "medium", promote: false, reason: "exact-authenticated-from", sourceId: source.id };
    }
    if (fromMatches.length > 1) {
      return {
        action: "provisional",
        confidence: "low",
        reason: "ambiguous-authenticated-from",
        suggestedSourceIds: fromMatches.map((source) => source.id)
      };
    }
  }

  return { action: "provisional", confidence: "unknown", reason: "no-stable-identity", suggestedSourceIds: [] };
}
