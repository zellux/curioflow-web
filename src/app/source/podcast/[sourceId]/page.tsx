import { CurioflowHome, type HomeProps } from "../../../curioflow-home";

type PodcastSourcePageProps = {
  params: Promise<{ sourceId: string }>;
  searchParams?: HomeProps["searchParams"];
};

export default async function PodcastSourcePage({ params, searchParams }: PodcastSourcePageProps) {
  const { sourceId } = await params;
  return CurioflowHome({ searchParams, routeParams: { source: sourceId, sourceKind: "podcast" } });
}
