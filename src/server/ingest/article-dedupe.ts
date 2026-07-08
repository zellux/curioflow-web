import { Prisma } from "@prisma/client";

export function isUniqueArticleItemForLibraryContentObjectError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  if (typeof target === "string") {
    return target === "items_library_id_content_object_id_key";
  }

  return Array.isArray(target) && target.includes("library_id") && target.includes("content_object_id");
}
