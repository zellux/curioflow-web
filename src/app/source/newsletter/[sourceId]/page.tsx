import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

type Props = HomeProps & { params: Promise<{ sourceId: string }> };

export default async function NewsletterSourcePage({ params, searchParams }: Props) {
  const { sourceId } = await params;
  return CurioflowHome({ searchParams, routeParams: { source: sourceId, sourceKind: "newsletter" } });
}
