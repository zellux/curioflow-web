import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

type SourcePageProps = {
  params: Promise<{ sourceId: string }>;
  searchParams?: HomeProps["searchParams"];
};

export default async function SourcePage({ params, searchParams }: SourcePageProps) {
  const { sourceId } = await params;
  return CurioflowHome({ searchParams, routeParams: { source: sourceId } });
}
