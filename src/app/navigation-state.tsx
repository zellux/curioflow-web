"use client";

import { createContext, type ReactNode, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

const NavigationContext = createContext<{
  pending: boolean;
  navigate: (href: string) => void;
} | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function navigate(href: string) {
    // React settles this state on completion or interruption, including a return
    // to the current route. A pathname-only effect cannot detect that case.
    startTransition(() => router.push(href as Route));
  }

  return (
    <NavigationContext.Provider value={{ pending, navigate }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigationState() {
  const state = useContext(NavigationContext);
  if (!state) throw new Error("Navigation state requires NavigationProvider");
  return state;
}
