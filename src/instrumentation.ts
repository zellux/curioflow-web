export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureBackgroundJobScheduler } = await import("@/server/background-jobs");
    const { ensureMonitoringScheduler } = await import("@/server/monitoring");
    ensureBackgroundJobScheduler();
    ensureMonitoringScheduler();
  }
}
