import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isUniqueArticleItemForLibraryContentObjectError } from "./ingest/article-dedupe.ts";

test("recognizes article item unique constraint conflicts", () => {
  const postgresError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["library_id", "content_object_id"] }
  });
  const sqliteError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: "items_library_id_content_object_id_key" }
  });
  const unrelatedError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["url_hash"] }
  });

  assert.equal(isUniqueArticleItemForLibraryContentObjectError(postgresError), true);
  assert.equal(isUniqueArticleItemForLibraryContentObjectError(sqliteError), true);
  assert.equal(isUniqueArticleItemForLibraryContentObjectError(unrelatedError), false);
});
