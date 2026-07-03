import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { hasSecretEncryptionKey, isEncryptedSecret } from "@/server/secrets";

export async function GET() {
  const llmSettings = await prisma.llmSetting.findMany({
    where: { apiKey: { not: null } },
    select: { apiKey: true }
  });
  const plaintextKeyCount = llmSettings.filter((setting) => !isEncryptedSecret(setting.apiKey)).length;
  const issues = [
    ...(process.env.NODE_ENV === "production" && !hasSecretEncryptionKey()
      ? ["CURIOFLOW_SECRET_KEY is not configured."]
      : []),
    ...(plaintextKeyCount > 0
      ? [`${plaintextKeyCount} stored LLM API key${plaintextKeyCount === 1 ? "" : "s"} are not encrypted.`]
      : [])
  ];

  return NextResponse.json({
    ok: issues.length === 0,
    checks: {
      secretEncryptionKeyConfigured: hasSecretEncryptionKey(),
      storedLlmApiKeysEncrypted: plaintextKeyCount === 0
    },
    issues
  }, { status: issues.length === 0 ? 200 : 503 });
}
