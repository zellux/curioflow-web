export function backgroundWorkRunsHere(environment = process.env) {
  if (environment.CURIOFLOW_RUN_BACKGROUND_WORKER === "true") return true;
  if (environment.CURIOFLOW_RUN_BACKGROUND_WORKER === "false") return false;
  return environment.NODE_ENV !== "production";
}
