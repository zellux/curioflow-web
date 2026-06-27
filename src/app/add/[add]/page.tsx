import { CurioflowHome, type HomeProps } from "../../curioflow-home";

type AddPageProps = {
  params: Promise<{ add: string }>;
  searchParams?: HomeProps["searchParams"];
};

export default async function AddPage({ params, searchParams }: AddPageProps) {
  const { add } = await params;
  return CurioflowHome({ searchParams, routeParams: { add } });
}
