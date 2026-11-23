import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default function SubscriptionsPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { filter: "recent-posts" } });
}
