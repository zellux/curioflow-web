import { CurioflowHome, type HomeProps } from "../../curioflow-home";

type StatusPageProps = {
  params: Promise<{ status: string }>;
  searchParams?: HomeProps["searchParams"];
};

export default async function StatusPage({ params, searchParams }: StatusPageProps) {
  const { status } = await params;
  return CurioflowHome({ searchParams, routeParams: { status } });
}
