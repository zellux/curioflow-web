import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default function ArchivePage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { filter: "archive" } });
}
