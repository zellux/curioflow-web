import { CurioflowHome, type HomeProps } from "../../../curioflow-home";

export default function RecentFeedPostsPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { filter: "recent-posts" } });
}
