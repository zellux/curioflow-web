import { redirect } from "next/navigation";
import { SHOW_DRAFT_READING_TOOLS } from "@/app/workspace-features";
import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default function BriefingPage({ searchParams }: HomeProps) {
  if (!SHOW_DRAFT_READING_TOOLS) redirect("/home");
  return CurioflowHome({ searchParams, routeParams: { view: "brief" } });
}
