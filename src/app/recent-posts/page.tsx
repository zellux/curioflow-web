import type { Route } from "next";
import { redirect } from "next/navigation";

export default function RecentPostsPage() {
  redirect("/source/feed/recent" as Route);
}
