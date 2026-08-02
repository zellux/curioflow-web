import assert from "node:assert/strict";
import test from "node:test";
import {
  NEWSLETTER_IDENTITY_KIND,
  decideNewsletterGrouping,
  newsletterListDescription,
  newsletterSourceName,
  normalizeNewsletterEmailAddress,
  normalizeNewsletterListId,
  type NewsletterGroupingSource
} from "./newsletter-grouping.ts";

function source(
  id: string,
  identities: NewsletterGroupingSource["identities"],
  status = "active"
): NewsletterGroupingSource {
  return { id, identities, status };
}

test("normalizes newsletter identity headers", () => {
  assert.equal(normalizeNewsletterListId(" Lenny's Newsletter <Lenny.Example.COM> "), "lenny.example.com");
  assert.equal(newsletterListDescription(" Lenny's Newsletter <lenny.example.com> "), "Lenny's Newsletter");
  assert.equal(normalizeNewsletterEmailAddress("Lenny <NEWS@Example.COM>"), "news@example.com");
  assert.equal(normalizeNewsletterEmailAddress("not-an-address"), null);
});

test("prefers a list description when naming a source", () => {
  assert.equal(newsletterSourceName({
    fromAddress: "lenny@example.com",
    fromName: "Lenny",
    listIdHeader: "Lenny's Newsletter <lenny.example.com>"
  }), "Lenny's Newsletter");
  assert.equal(newsletterSourceName({ fromAddress: "news@example.com" }), "example.com");
});

test("groups an exact list id with high confidence", () => {
  const decision = decideNewsletterGrouping({
    authenticatedFrom: true,
    fromAddress: "campaign@example.com",
    listId: "Newsletter <weekly.example.com>"
  }, [source("weekly", [
    { blocked: false, kind: NEWSLETTER_IDENTITY_KIND.LIST_ID, value: "weekly.example.com" }
  ])]);

  assert.deepEqual(decision, {
    action: "match",
    confidence: "high",
    promote: false,
    reason: "exact-list-id",
    sourceId: "weekly"
  });
});

test("promotes one provisional sender when its first list id arrives", () => {
  const decision = decideNewsletterGrouping({
    authenticatedFrom: true,
    fromAddress: "newsletter@example.com",
    listId: "weekly.example.com"
  }, [source("provisional", [
    { blocked: false, kind: NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS, value: "newsletter@example.com" }
  ], "provisional")]);

  assert.equal(decision.action, "match");
  if (decision.action === "match") {
    assert.equal(decision.sourceId, "provisional");
    assert.equal(decision.promote, true);
  }
});

test("does not merge a new list id into active sender history", () => {
  const decision = decideNewsletterGrouping({
    authenticatedFrom: true,
    fromAddress: "news@example.com",
    listId: "second.example.com"
  }, [source("first", [
    { blocked: false, kind: NEWSLETTER_IDENTITY_KIND.LIST_ID, value: "first.example.com" },
    { blocked: false, kind: NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS, value: "news@example.com" }
  ])]);

  assert.deepEqual(decision, {
    action: "provisional",
    confidence: "low",
    reason: "new-list-id-conflicts-with-sender-history",
    suggestedSourceIds: ["first"]
  });
});

test("groups one authenticated from address when no list id exists", () => {
  const decision = decideNewsletterGrouping({
    authenticatedFrom: true,
    fromAddress: "newsletter@example.com"
  }, [source("weekly", [
    { blocked: false, kind: NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS, value: "newsletter@example.com" }
  ])]);

  assert.equal(decision.action, "match");
  if (decision.action === "match") assert.equal(decision.confidence, "medium");
});

test("splits ambiguous senders instead of merging", () => {
  const identities = [{
    blocked: false,
    kind: NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS,
    value: "news@provider.example"
  }] as const;
  const decision = decideNewsletterGrouping({
    authenticatedFrom: true,
    fromAddress: "news@provider.example"
  }, [source("one", [...identities]), source("two", [...identities])]);

  assert.equal(decision.action, "provisional");
  if (decision.action === "provisional") {
    assert.equal(decision.reason, "ambiguous-authenticated-from");
    assert.deepEqual(decision.suggestedSourceIds, ["one", "two"]);
  }
});

test("does not group an unauthenticated sender", () => {
  const decision = decideNewsletterGrouping({
    authenticatedFrom: false,
    fromAddress: "newsletter@example.com"
  }, [source("weekly", [
    { blocked: false, kind: NEWSLETTER_IDENTITY_KIND.FROM_ADDRESS, value: "newsletter@example.com" }
  ])]);

  assert.equal(decision.action, "provisional");
});

test("does not trust a spoofed list id", () => {
  const decision = decideNewsletterGrouping({
    authenticatedFrom: false,
    fromAddress: "attacker@example.net",
    listId: "weekly.example.com"
  }, [source("weekly", [
    { blocked: false, kind: NEWSLETTER_IDENTITY_KIND.LIST_ID, value: "weekly.example.com" }
  ])]);

  assert.deepEqual(decision, {
    action: "provisional",
    confidence: "low",
    reason: "unauthenticated-list-id",
    suggestedSourceIds: []
  });
});

test("honors blocked stable identities", () => {
  const decision = decideNewsletterGrouping({
    authenticatedFrom: true,
    fromAddress: "newsletter@example.com",
    listId: "weekly.example.com"
  }, [source("weekly", [
    { blocked: true, kind: NEWSLETTER_IDENTITY_KIND.LIST_ID, value: "weekly.example.com" }
  ])]);

  assert.deepEqual(decision, {
    action: "blocked",
    confidence: "high",
    reason: "blocked-list-id",
    sourceId: "weekly"
  });
});
