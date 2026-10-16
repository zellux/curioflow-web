import { redirect } from "next/navigation";
import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default async function SettingsPage({ searchParams }: HomeProps) {
  const params = (await searchParams) ?? {};
  // Keep existing diagnostic bookmarks useful after moving them out of Settings.
  if (params?.settingsTab === "tasks" || params?.settingsTab === "connections") {
    redirect(`/debug?tab=${params.settingsTab}`);
  }
  return CurioflowHome({ searchParams: Promise.resolve(params), routeParams: { settings: "1" } });
}
