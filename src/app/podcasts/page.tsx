import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default function PodcastsPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { filter: "podcasts" } });
}
