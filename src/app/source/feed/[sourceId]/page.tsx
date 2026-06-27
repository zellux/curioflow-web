import { CurioflowHome, type HomeProps } from "../../../curioflow-home";

type FeedSourcePageProps = {
  params: Promise<{ sourceId: string }>;
  searchParams?: HomeProps["searchParams"];
};

export default async function FeedSourcePage({ params, searchParams }: FeedSourcePageProps) {
  const { sourceId } = await params;
  return CurioflowHome({ searchParams, routeParams: { source: sourceId, sourceKind: "feed" } });
}
