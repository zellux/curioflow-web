import { CurioflowHome, type HomeProps } from "../curioflow-home";

export default function SettingsPage({ searchParams }: HomeProps) {
  return CurioflowHome({ searchParams, routeParams: { settings: "1" } });
}
