import {
  newsletterSenderDomain,
  normalizeNewsletterEmailAddress
} from "./newsletter-grouping.ts";

type SesHeader = { name?: unknown; value?: unknown };
type SesMail = {
  commonHeaders?: { from?: unknown; messageId?: unknown; subject?: unknown };
  destination?: unknown;
  headers?: unknown;
  messageId?: unknown;
  source?: unknown;
  timestamp?: unknown;
};
type SesReceipt = {
  action?: { bucketName?: unknown; objectKey?: unknown };
  dkimVerdict?: { status?: unknown };
  dmarcVerdict?: { status?: unknown };
  spamVerdict?: { status?: unknown };
  spfVerdict?: { status?: unknown };
  virusVerdict?: { status?: unknown };
};
type SesRecord = {
  eventSource?: unknown;
  ses?: { mail?: SesMail; receipt?: SesReceipt };
};
type SesNotification = { mail?: SesMail; receipt?: SesReceipt };

export type ParsedSesNewsletterEvent = {
  address: string;
  authenticatedDomain: string | null;
  authenticatedFrom: boolean;
  bucket: string | null;
  dkimVerdict: "fail" | "gray" | "pass" | "processing_failed" | "unknown";
  dmarcVerdict: "fail" | "gray" | "pass" | "processing_failed" | "unknown";
  envelopeFrom: string | null;
  listIdHeader: string | null;
  objectKey: string;
  providerMessageId: string;
  receivedAt: Date;
  spamVerdict: "fail" | "gray" | "pass" | "processing_failed" | "unknown";
  spfVerdict: "fail" | "gray" | "pass" | "processing_failed" | "unknown";
  subject: string | null;
  virusVerdict: "fail" | "gray" | "pass" | "processing_failed" | "unknown";
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unwrapBody(body: string) {
  let value: unknown = JSON.parse(body);
  const envelope = object(value);
  if (typeof envelope?.Message === "string") value = JSON.parse(envelope.Message);
  return value;
}

function verdict(value: unknown): ParsedSesNewsletterEvent["spamVerdict"] {
  const normalized = string(object(value)?.status)?.toLowerCase().replace(/-/g, "_");
  return normalized === "pass" || normalized === "fail" || normalized === "gray" || normalized === "processing_failed"
    ? normalized
    : "unknown";
}

function header(headers: unknown, name: string) {
  if (!Array.isArray(headers)) return null;
  const match = (headers as SesHeader[]).find((candidate) => string(candidate.name)?.toLowerCase() === name.toLowerCase());
  return string(match?.value);
}

function dkimDomain(headers: unknown) {
  return header(headers, "DKIM-Signature")?.match(/(?:^|;)\s*d=([^;\s]+)/i)?.[1]?.toLowerCase() ?? null;
}

function alignedDomains(fromDomain: string | null, signingDomain: string | null) {
  if (!fromDomain || !signingDomain) return false;
  return fromDomain === signingDomain
    || fromDomain.endsWith(`.${signingDomain}`)
    || signingDomain.endsWith(`.${fromDomain}`);
}

function firstString(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.flatMap((candidate) => string(candidate) ? [string(candidate)!] : [])[0] ?? null;
}

export function parseSesNewsletterEvent(body: string): ParsedSesNewsletterEvent {
  const payload = object(unwrapBody(body));
  const records = Array.isArray(payload?.Records) ? payload.Records as SesRecord[] : [];
  const record = records.find((candidate) => candidate.eventSource === "aws:ses" || candidate.ses);
  const notification = payload as SesNotification | null;
  const mail = record?.ses?.mail ?? notification?.mail;
  const receipt = record?.ses?.receipt ?? notification?.receipt;
  const providerMessageId = string(mail?.messageId);
  const address = firstString(mail?.destination)?.toLowerCase() ?? null;
  const objectKey = string(receipt?.action?.objectKey) ?? providerMessageId;
  if (!providerMessageId || !address || !objectKey) throw new Error("SES notification is missing message id, destination, or S3 object key");

  const headers = mail?.headers;
  const fromHeader = firstString(mail?.commonHeaders?.from) ?? header(headers, "From");
  const fromAddress = normalizeNewsletterEmailAddress(fromHeader);
  const signingDomain = dkimDomain(headers);
  const dkimVerdict = verdict(receipt?.dkimVerdict);
  const dmarcVerdict = verdict(receipt?.dmarcVerdict);
  const authenticatedFrom = dmarcVerdict === "pass"
    || (dkimVerdict === "pass" && alignedDomains(newsletterSenderDomain(fromAddress), signingDomain));

  const timestamp = string(mail?.timestamp);
  const receivedAt = timestamp ? new Date(timestamp) : new Date();
  return {
    address,
    authenticatedDomain: authenticatedFrom ? signingDomain ?? newsletterSenderDomain(fromAddress) : null,
    authenticatedFrom,
    bucket: string(receipt?.action?.bucketName),
    dkimVerdict,
    dmarcVerdict,
    envelopeFrom: string(mail?.source),
    listIdHeader: header(headers, "List-ID"),
    objectKey,
    providerMessageId,
    receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
    spamVerdict: verdict(receipt?.spamVerdict),
    spfVerdict: verdict(receipt?.spfVerdict),
    subject: string(mail?.commonHeaders?.subject),
    virusVerdict: verdict(receipt?.virusVerdict)
  };
}
