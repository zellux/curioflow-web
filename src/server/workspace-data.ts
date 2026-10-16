import { cache } from "react";
import { getCurrentLibrary, getCurrentUser } from "@/server/auth";
import { getLlmSettingsForAccount } from "@/server/settings";
import { getLibrarySources } from "@/server/sources";

// Share promises within one server render only. Account data must never enter a
// process-wide cache, and a slow source query must not hold up the app frame.
export const getWorkspaceData = cache(async () => {
  const user = await getCurrentUser();
  const [library, llmSettings] = await Promise.all([
    getCurrentLibrary(),
    getLlmSettingsForAccount(user.accountId)
  ]);
  return { user, library, llmSettings };
});

export const getWorkspaceSources = cache(getLibrarySources);
