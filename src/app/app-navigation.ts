import type { Route } from "next";
import { appHref } from "@/app/routes";

export type ReaderEntryContext = {
  label: string;
  query: Record<string, string | undefined>;
};

export function buildHref(params: Record<string, string | undefined>) {
  return appHref(params);
}

export function appRoute(params: Record<string, string | undefined>) {
  return appHref(params) as Route;
}

export function readerItemRoute(itemId: string, entryContext: ReaderEntryContext) {
  return appRoute({ ...entryContext.query, item: itemId });
}
