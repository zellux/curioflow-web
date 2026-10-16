import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default function BriefingPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { view: "brief" } });
}
