import { CurioflowHome, type HomeProps } from "../../curioflow-home";

type ItemPageProps = {
  params: Promise<{ itemId: string }>;
  searchParams?: HomeProps["searchParams"];
};

export default async function ItemPage({ params, searchParams }: ItemPageProps) {
  const { itemId } = await params;
  return CurioflowHome({ searchParams, routeParams: { item: itemId } });
}
