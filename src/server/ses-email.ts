import { createHash, createHmac } from "node:crypto";

const AWS_ALGORITHM = "AWS4-HMAC-SHA256";
const AWS_SERVICE = "ses";

type SendEmailInput = {
  html: string;
  subject: string;
  text: string;
  to: string;
};

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function amzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function dateStamp(date: Date) {
  return amzDate(date).slice(0, 8);
}

function signingKey(secretAccessKey: string, date: string, region: string) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, AWS_SERVICE);
  return hmac(serviceKey, "aws4_request");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to send password reset email`);
  return value;
}

export function passwordResetEmailConfigured() {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID?.trim() &&
    process.env.AWS_SECRET_ACCESS_KEY?.trim() &&
    process.env.AWS_REGION?.trim() &&
    process.env.CURIOFLOW_PASSWORD_RESET_FROM?.trim()
  );
}

export async function sendPasswordResetEmail({ html, subject, text, to }: SendEmailInput) {
  const accessKeyId = requiredEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("AWS_SECRET_ACCESS_KEY");
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
  const region = requiredEnv("AWS_REGION");
  const from = requiredEnv("CURIOFLOW_PASSWORD_RESET_FROM");
  const endpoint = new URL(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`);
  const now = new Date();
  const requestDate = amzDate(now);
  const requestDateStamp = dateStamp(now);

  const body = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: text, Charset: "UTF-8" },
          Html: { Data: html, Charset: "UTF-8" }
        }
      }
    }
  });

  const payloadHash = sha256Hex(body);
  const canonicalHeaderEntries = [
    "content-type:application/json",
    `host:${endpoint.host}`,
    sessionToken ? `x-amz-security-token:${sessionToken}` : null,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${requestDate}`
  ].filter((header): header is string => Boolean(header));
  const canonicalHeaders = canonicalHeaderEntries.join("\n") + "\n";
  const signedHeaders = canonicalHeaderEntries.map((header) => header.slice(0, header.indexOf(":"))).join(";");
  const canonicalRequest = [
    "POST",
    endpoint.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${requestDateStamp}/${region}/${AWS_SERVICE}/aws4_request`;
  const stringToSign = [
    AWS_ALGORITHM,
    requestDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signature = hmacHex(signingKey(secretAccessKey, requestDateStamp, region), stringToSign);
  const authorization = `${AWS_ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    "authorization": authorization,
    "content-type": "application/json",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": requestDate
  };

  if (sessionToken) {
    headers["x-amz-security-token"] = sessionToken;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`SES SendEmail failed with ${response.status}: ${errorBody}`);
  }
}
