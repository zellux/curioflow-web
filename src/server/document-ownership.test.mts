import assert from "node:assert/strict";
import test from "node:test";
import { accountDocumentOwnershipWhere, documentVisibleToAccount } from "./document-ownership.ts";

test("public documents are reusable while private documents are account scoped", () => {
  assert.equal(documentVisibleToAccount({ ownerAccountId: null }, "account-a"), true);
  assert.equal(documentVisibleToAccount({ ownerAccountId: "account-a" }, "account-a"), true);
  assert.equal(documentVisibleToAccount({ ownerAccountId: "account-a" }, "account-b"), false);
  assert.deepEqual(accountDocumentOwnershipWhere("account-a"), {
    OR: [{ ownerAccountId: null }, { ownerAccountId: "account-a" }]
  });
});
