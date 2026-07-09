import type { Route } from "next";
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/home" as Route);
}
