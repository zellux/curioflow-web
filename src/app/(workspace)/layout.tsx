import { Suspense } from "react";
import { MobileAppShell } from "@/app/mobile-app-shell";
import { NavigationFeedback } from "@/app/navigation-feedback";
import { Sidebar } from "@/app/sidebar";
import { WorkspaceLabel } from "@/app/workspace-label";
import { getUiCopy, normalizeSystemLanguage, type SystemLanguage } from "@/app/i18n";
import { getWorkspaceData, getWorkspaceSources } from "@/server/workspace-data";
import { getWorkspaceBackgroundState } from "@/server/workspace-background";
import { JobStatusRefresh } from "@/app/job-status-refresh";

async function WorkspaceSidebar({ locale, llmEnabled, userName }: {
  locale: SystemLanguage; llmEnabled: boolean; userName: string;
}) {
  let sources;
  try {
    sources = await getWorkspaceSources();
  } catch {
    return <Sidebar locale={locale} llmEnabled={llmEnabled} userName={userName} sources={[]} sourcesError />;
  }
  // Only send display fields across the client boundary, never source config.
  return <Sidebar locale={locale} llmEnabled={llmEnabled} userName={userName} sources={sources.map(source => ({
    id: source.id, name: source.name, type: source.type, category: source.category,
    status: source.status, pendingCount: source.pendingCount, streamCount: source.streamCount, _count: source._count
  }))} />;
}

async function WorkspaceTitle({ locale, llmEnabled }: { locale: SystemLanguage; llmEnabled: boolean }) {
  const sources = await getWorkspaceSources().catch(() => []);
  return <WorkspaceLabel locale={locale} llmEnabled={llmEnabled} sources={sources.map(({ id, name }) => ({ id, name }))} />;
}

async function WorkspaceJobs({ locale }: { locale: SystemLanguage }) {
  const { library } = await getWorkspaceData();
  const initialState = await getWorkspaceBackgroundState(library.id).catch(() => null);
  return <JobStatusRefresh initialState={initialState} locale={locale} />;
}

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user, library, llmSettings } = await getWorkspaceData();
  const locale = normalizeSystemLanguage(llmSettings.systemLanguage);
  const copy = getUiCopy(locale);
  const sidebarProps = { locale, llmEnabled: llmSettings.enabled, userName: user.displayName };

  return <MobileAppShell addSourceLabel={copy.nav.addSource} locale={locale}
    label={<Suspense fallback={copy.nav.library}><WorkspaceTitle locale={locale} llmEnabled={llmSettings.enabled} /></Suspense>}
    sidebar={<Suspense fallback={<Sidebar {...sidebarProps} sources={[]} sourcesLoading />}>
      <WorkspaceSidebar {...sidebarProps} />
    </Suspense>}>
    <a className="skipToContent" href="#main-content">{copy.common.skipToContent}</a>
    <section className="mainShell" id="main-content" tabIndex={-1} aria-label={library.name}>
      <NavigationFeedback locale={locale} />
      <Suspense fallback={null}><WorkspaceJobs locale={locale} /></Suspense>
      {children}
    </section>
  </MobileAppShell>;
}
