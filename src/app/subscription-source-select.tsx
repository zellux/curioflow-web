"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";

type SourceOption = { href: Route; label: string };

export function SubscriptionSourceSelect({ all, groups, label, value }: {
  all: SourceOption;
  groups: { name: string | null; options: SourceOption[] }[];
  label: string;
  value: Route;
}) {
  const router = useRouter();
  return (
    <select
      aria-label={label}
      className="subscriptionSourceSelect"
      onChange={(event) => router.push(event.currentTarget.value as Route)}
      value={value}
    >
      <option value={all.href}>{all.label}</option>
      {groups.map(({ name, options }) => {
        const entries = options.map(({ href, label }) => <option key={href} value={href}>{label}</option>);
        return name ? <optgroup key={name} label={name}>{entries}</optgroup> : entries;
      })}
    </select>
  );
}
