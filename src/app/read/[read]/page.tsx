import { CurioflowHome, type HomeProps } from "../../curioflow-home";

type ReadPageProps = {
  params: Promise<{ read: string }>;
  searchParams?: HomeProps["searchParams"];
};

export default async function ReadPage({ params, searchParams }: ReadPageProps) {
  const { read } = await params;
  return CurioflowHome({ searchParams, routeParams: { read } });
}
