import { CurioflowHome, type HomeProps } from "../curioflow-home";

export default function BriefingPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { view: "brief" } });
}
