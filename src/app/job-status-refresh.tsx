"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useNavigationState } from "@/app/navigation-state";

export function JobStatusRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const { pending } = useNavigationState();

  useEffect(() => {
    if (!active || pending) return;

    const interval = window.setInterval(() => {
      router.refresh();
    }, 4000);

    return () => window.clearInterval(interval);
  }, [active, pending, router]);

  return null;
}
