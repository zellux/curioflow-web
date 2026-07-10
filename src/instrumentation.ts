export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeConfiguration } = await import("@/server/runtime-config");
    const { ensureBackgroundJobScheduler } = await import("@/server/background-jobs");
    const { ensureMonitoringScheduler } = await import("@/server/monitoring");
    const { backgroundWorkRunsHere } = await import("@/server/worker-runtime");
    validateRuntimeConfiguration();
    if (backgroundWorkRunsHere()) ensureBackgroundJobScheduler();
    else ensureMonitoringScheduler();
  }
}
