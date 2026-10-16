import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default function AskPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { view: "ask" } });
}
