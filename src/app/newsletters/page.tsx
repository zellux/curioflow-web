import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default function NewslettersPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { filter: "newsletters" } });
}
