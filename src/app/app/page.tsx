import type { Route } from "next";
import { redirect } from "next/navigation";

export default function AppPage() {
  redirect("/home" as Route);
}
