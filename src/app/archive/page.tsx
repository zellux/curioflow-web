import { CurioflowHome, type HomeProps } from "../curioflow-home";

export default function ArchivePage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { filter: "archive" } });
}
