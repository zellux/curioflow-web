import packageManifest from "../../package.json" with { type: "json" };

export const MOBILE_PROTOCOL_VERSION = 1;
export const MINIMUM_MOBILE_CLIENT_VERSION = "1.0.0";
export const MOBILE_CAPABILITIES = [
  "ios_access",
  "bounded_mutation_batches",
  "idempotent_mutations",
  "account_scoped_sync",
  "revision_sync",
  "annotation_mutations",
  "newsletter_inbox",
  "original_pdf_file"
] as const;

export function mobileProtocolMetadata() {
  return {
    version: MOBILE_PROTOCOL_VERSION,
    serverVersion: packageManifest.version,
    minimumClientVersion: MINIMUM_MOBILE_CLIENT_VERSION,
    capabilities: [...MOBILE_CAPABILITIES],
    plan: "self_hosted",
    entitlementExpiresAt: null,
    entitlementGraceUntil: null
  };
}
