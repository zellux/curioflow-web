import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default function HighlightsPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { view: "highlights" } });
}
