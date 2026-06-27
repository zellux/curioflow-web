import { CurioflowHome, type HomeProps } from "../curioflow-home";

export default function RecentPostsPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { filter: "recent-posts" } });
}
