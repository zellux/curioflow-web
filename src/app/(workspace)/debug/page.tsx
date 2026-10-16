import { CurioflowHome, type HomeProps } from "@/app/curioflow-home";

export default async function DebugPage({ searchParams }: HomeProps) {
  const params = await searchParams;
  return CurioflowHome({ searchParams: Promise.resolve({ ...params, view: "debug", debugTab: params?.tab, taskStatus: params?.status }) });
}
