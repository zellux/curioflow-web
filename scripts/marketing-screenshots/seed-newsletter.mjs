import { createHash, scrypt as scryptCallback } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const password = process.env.MARKETING_SCREENSHOT_PASSWORD?.trim() ?? "";

if (!databaseUrl.includes("curioflow-marketing")) {
  throw new Error("Refusing to seed: DATABASE_URL must contain curioflow-marketing");
}

if (!password) {
  throw new Error("MARKETING_SCREENSHOT_PASSWORD is required");
}

const fixtureUrl = new URL("../../test/fixtures/marketing/v2.json", import.meta.url);
const fixture = JSON.parse(await readFile(fileURLToPath(fixtureUrl), "utf8"));
const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

async function hashPassword(value) {
  const salt = fixture.version;
  const derived = await scrypt(value, salt, 64);
  return `scrypt-v1$${salt}$${Buffer.from(derived).toString("base64url")}`;
}

function safeHtml(paragraphs) {
  return paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("\n");
}

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rssIssueUrl(sourceUrl, issueId) {
  return new URL(`/issues/${issueId}`, new URL(sourceUrl).origin).toString();
}

function rssArchiveIssue(source, title, issueIndex) {
  const publishedAt = new Date("2026-07-21T15:00:00.000Z");
  publishedAt.setUTCDate(publishedAt.getUTCDate() - issueIndex * 3);
  return {
    id: `archive-${issueIndex + 1}`,
    title,
    publishedAt: publishedAt.toISOString(),
    readingProgress: 0,
    summary: `${title} — an earlier edition from ${source.name}, exploring ${source.description.charAt(0).toLowerCase()}${source.description.slice(1)}`
  };
}

function rssArticleBody(source, issue) {
  return [
    issue.summary,
    source.description,
    `Each edition of ${source.name} begins with one practical question, follows it far enough to reveal the underlying pattern, and closes with a useful place to return.`
  ];
}

async function main() {
  const { workspace } = fixture;
  const passwordHash = await hashPassword(password);

  await prisma.account.create({
    data: { id: workspace.accountId, name: workspace.accountName }
  });
  await prisma.user.create({
    data: {
      id: workspace.userId,
      accountId: workspace.accountId,
      username: workspace.username,
      email: workspace.email,
      displayName: workspace.displayName,
      passwordHash
    }
  });
  await prisma.library.create({
    data: {
      id: workspace.libraryId,
      accountId: workspace.accountId,
      name: workspace.libraryName
    }
  });
  await prisma.readingPreference.create({
    data: {
      id: "reading-preference-marketing-v2",
      accountId: workspace.accountId,
      theme: "broadsheet",
      font: "serif",
      colorMode: "bright",
      fontScale: 1
    }
  });
  await prisma.llmSetting.create({
    data: {
      id: "llm-setting-marketing-v2",
      accountId: workspace.accountId,
      enabled: false,
      provider: "managed",
      model: "managed",
      askModel: "managed",
      systemLanguage: "en",
      summaryLanguage: "en",
      summaryConcurrency: 1
    }
  });
  await prisma.newsletterAddress.create({
    data: {
      id: "newsletter-address-marketing-v2",
      accountId: workspace.accountId,
      libraryId: workspace.libraryId,
      address: fixture.newsletterAddress,
      tokenHash: tokenHash("marketing-v2-address-token"),
      status: "active",
      createdAt: new Date(fixture.captureTime)
    }
  });

  let rssSourceCount = 0;
  let rssItemCount = 0;
  for (const category of fixture.rssCategories) {
    for (const source of category.sources) {
      const sourceId = `source-rss-${source.id}-v2`;
      const sourceCreatedAt = new Date("2026-07-01T12:00:00.000Z");
      sourceCreatedAt.setUTCHours(sourceCreatedAt.getUTCHours() + rssSourceCount);
      await prisma.source.create({
        data: {
          id: sourceId,
          libraryId: workspace.libraryId,
          type: "rss",
          name: source.name,
          url: source.url,
          category: category.name,
          status: "active",
          nextFetchAt: new Date("2099-01-01T00:00:00.000Z"),
          autoSaveToLibrary: false,
          createdAt: sourceCreatedAt
        }
      });
      rssSourceCount += 1;

      const issues = [
        source.featuredIssue,
        ...source.archiveTitles.map((title, issueIndex) => rssArchiveIssue(source, title, issueIndex))
      ];
      for (const issue of issues) {
        const issueKey = `${source.id}-${issue.id}`;
        const itemId = `item-rss-${issueKey}-v2`;
        const contentObjectId = `content-rss-${issueKey}-v2`;
        const documentId = `document-rss-${issueKey}-v2`;
        const issueUrl = rssIssueUrl(source.url, issue.id);
        const body = rssArticleBody(source, issue);
        const publishedAt = new Date(issue.publishedAt);

        await prisma.contentObject.create({
          data: {
            id: contentObjectId,
            canonicalKey: `marketing:v2:rss:${issueKey}`,
            type: "article",
            cacheScope: "public_web",
            normalizedUrl: issueUrl,
            urlHash: tokenHash(issueUrl),
            latestDocumentId: documentId,
            status: "ready",
            firstSeenAt: publishedAt,
            lastSeenAt: publishedAt,
            createdAt: publishedAt
          }
        });
        await prisma.document.create({
          data: {
            id: documentId,
            contentObjectId,
            contentType: "text/html",
            title: issue.title,
            articleHtml: safeHtml(body),
            text: body.join("\n\n"),
            contentHash: `marketing-v2-rss-${issueKey}`,
            parserVersion: "marketing-rss-v2",
            language: "en",
            metadataJson: JSON.stringify({
              excerpt: issue.summary,
              fixture: fixture.version,
              source: source.name,
              category: category.name
            }),
            createdAt: publishedAt
          }
        });
        await prisma.item.create({
          data: {
            id: itemId,
            libraryId: workspace.libraryId,
            sourceId,
            contentObjectId,
            documentId,
            type: "article",
            title: issue.title,
            url: issueUrl,
            author: source.name,
            publishedAt,
            status: "ready",
            readStatus: "unread",
            savedToLibrary: false,
            readingProgress: issue.readingProgress,
            lastReadAt: issue.readingProgress > 0 ? new Date(fixture.captureTime) : null,
            createdAt: publishedAt,
            updatedAt: publishedAt
          }
        });
        await prisma.sourceEntry.create({
          data: {
            id: `source-entry-rss-${issueKey}-v2`,
            libraryId: workspace.libraryId,
            sourceId,
            itemId,
            entryKey: `marketing:v2:rss:${issueKey}`,
            url: issueUrl,
            title: issue.title,
            author: source.name,
            publishedAt,
            firstSeenAt: publishedAt,
            lastSeenAt: publishedAt
          }
        });
        rssItemCount += 1;
      }
    }
  }

  for (const [sourceIndex, newsletter] of fixture.newsletters.entries()) {
    const sourceId = `source-newsletter-${newsletter.id}-v2`;
    await prisma.source.create({
      data: {
        id: sourceId,
        libraryId: workspace.libraryId,
        type: "newsletter",
        name: newsletter.name,
        status: "active",
        nextFetchAt: new Date("2099-01-01T00:00:00.000Z"),
        createdAt: new Date(newsletter.issues.at(-1).receivedAt)
      }
    });
    await prisma.newsletterIdentity.createMany({
      data: [
        {
          id: `identity-list-${newsletter.id}-v2`,
          libraryId: workspace.libraryId,
          sourceId,
          kind: "list_id",
          value: newsletter.listId,
          authenticatedDomain: newsletter.sender.split("@")[1],
          confidence: "high",
          userConfirmed: true,
          firstSeenAt: new Date(newsletter.issues.at(-1).receivedAt),
          lastSeenAt: new Date(newsletter.issues[0].receivedAt)
        },
        {
          id: `identity-sender-${newsletter.id}-v2`,
          libraryId: workspace.libraryId,
          sourceId,
          kind: "from_address",
          value: newsletter.sender,
          authenticatedDomain: newsletter.sender.split("@")[1],
          confidence: "high",
          userConfirmed: true,
          firstSeenAt: new Date(newsletter.issues.at(-1).receivedAt),
          lastSeenAt: new Date(newsletter.issues[0].receivedAt)
        }
      ]
    });

    for (const [issueIndex, issue] of newsletter.issues.entries()) {
      const itemId = `item-newsletter-${issue.id}-v2`;
      const contentObjectId = `content-newsletter-${issue.id}-v2`;
      const documentId = `document-newsletter-${issue.id}-v2`;
      const text = issue.body.join("\n\n");

      await prisma.contentObject.create({
        data: {
          id: contentObjectId,
          canonicalKey: `marketing:v2:newsletter:${issue.id}`,
          type: "article",
          cacheScope: "account_private",
          ownerAccountId: workspace.accountId,
          latestDocumentId: documentId,
          status: "ready",
          firstSeenAt: new Date(issue.receivedAt),
          lastSeenAt: new Date(issue.receivedAt),
          createdAt: new Date(issue.receivedAt)
        }
      });
      await prisma.document.create({
        data: {
          id: documentId,
          contentObjectId,
          ownerAccountId: workspace.accountId,
          contentType: "text/html",
          title: issue.subject,
          articleHtml: safeHtml(issue.body),
          text,
          contentHash: `marketing-v2-${issue.id}`,
          parserVersion: "marketing-newsletter-v2",
          language: "en",
          metadataJson: JSON.stringify({
            excerpt: issue.summary,
            fixture: fixture.version,
            newsletter: newsletter.name
          }),
          createdAt: new Date(issue.receivedAt)
        }
      });
      await prisma.item.create({
        data: {
          id: itemId,
          libraryId: workspace.libraryId,
          sourceId,
          contentObjectId,
          documentId,
          type: "article",
          title: issue.subject,
          author: newsletter.name,
          publishedAt: new Date(issue.receivedAt),
          status: "ready",
          readStatus: "unread",
          savedToLibrary: false,
          readingProgress: issueIndex === 0 && sourceIndex === 0 ? 0.18 : 0,
          createdAt: new Date(issue.receivedAt),
          updatedAt: new Date(issue.receivedAt)
        }
      });
      await prisma.sourceEntry.create({
        data: {
          id: `source-entry-newsletter-${issue.id}-v2`,
          libraryId: workspace.libraryId,
          sourceId,
          itemId,
          entryKey: `marketing:v2:newsletter:${issue.id}`,
          title: issue.subject,
          author: newsletter.name,
          publishedAt: new Date(issue.receivedAt),
          firstSeenAt: new Date(issue.receivedAt),
          lastSeenAt: new Date(issue.receivedAt)
        }
      });
      await prisma.inboundEmail.create({
        data: {
          id: `inbound-email-${issue.id}-v2`,
          libraryId: workspace.libraryId,
          addressId: "newsletter-address-marketing-v2",
          sourceId,
          itemId,
          providerMessageId: `marketing-v2-${issue.id}`,
          messageId: `<${issue.id}@${newsletter.sender.split("@")[1]}>`,
          envelopeFrom: newsletter.sender,
          fromAddress: newsletter.sender,
          fromName: newsletter.name,
          listId: newsletter.listId,
          subject: issue.subject,
          status: "processed",
          spfVerdict: "pass",
          dkimVerdict: "pass",
          dmarcVerdict: "pass",
          spamVerdict: "pass",
          virusVerdict: "pass",
          receivedAt: new Date(issue.receivedAt),
          processedAt: new Date(issue.receivedAt),
          createdAt: new Date(issue.receivedAt)
        }
      });
    }
  }

  console.log(
    `Seeded ${rssSourceCount} RSS subscriptions with ${rssItemCount} items across ${fixture.rssCategories.length} categories.`
  );
  console.log(`Seeded ${fixture.newsletters.length} synthetic newsletters for ${fixture.version}.`);
  console.log("Capture routes: /recent-posts, /newsletters?add=newsletter, and /item/item-newsletter-sunday-reset-v2?filter=newsletters");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
