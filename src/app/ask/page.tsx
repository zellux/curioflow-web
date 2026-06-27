import { CurioflowHome, type HomeProps } from "../curioflow-home";

export default function AskPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { view: "ask" } });
}
