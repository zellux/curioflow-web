import { redirect } from "next/navigation";
import type { HomeProps } from "@/app/curioflow-home";
import { appHref } from "@/app/routes";

export default async function LegacyRecentFeedPostsPage({ searchParams }: HomeProps) {
  redirect(appHref({ ...await searchParams, filter: "recent-posts" }));
}
