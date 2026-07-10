type RuntimeEnvironment = Record<string, string | undefined>;

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

function validateOptionalGroup(
  environment: RuntimeEnvironment,
  names: string[],
  enabled: boolean,
  issues: string[]
) {
  if (!enabled) return;
  for (const name of names) {
    if (!hasValue(environment[name])) issues.push(`${name} is required when this integration is configured.`);
  }
}

export function runtimeConfigurationIssues(environment: RuntimeEnvironment) {
  const issues: string[] = [];
  if (environment.NODE_ENV === "production") {
    if (!hasValue(environment.DATABASE_URL)) issues.push("DATABASE_URL is required in production.");
    if (!hasValue(environment.CURIOFLOW_SECRET_KEY)) issues.push("CURIOFLOW_SECRET_KEY is required in production.");

    const appUrl = environment.CURIOFLOW_APP_URL?.trim();
    if (!appUrl) {
      issues.push("CURIOFLOW_APP_URL is required in production.");
    } else if (!appUrl.startsWith("https://")) {
      issues.push("CURIOFLOW_APP_URL must use HTTPS in production.");
    }
  }

  const influxEnabled = [
    environment.CURIOFLOW_INFLUXDB_IP,
    environment.CURIOFLOW_INFLUXDB_URL,
    environment.CURIOFLOW_INFLUXDB_USERNAME,
    environment.CURIOFLOW_INFLUXDB_PASSWORD
  ].some(hasValue);
  if (influxEnabled && !hasValue(environment.CURIOFLOW_INFLUXDB_IP) && !hasValue(environment.CURIOFLOW_INFLUXDB_URL)) {
    issues.push("CURIOFLOW_INFLUXDB_IP or CURIOFLOW_INFLUXDB_URL is required when monitoring is configured.");
  }
  validateOptionalGroup(
    environment,
    ["CURIOFLOW_INFLUXDB_USERNAME", "CURIOFLOW_INFLUXDB_PASSWORD"],
    influxEnabled,
    issues
  );

  const sesEnabled = [
    environment.CURIOFLOW_PASSWORD_RESET_FROM,
    environment.AWS_REGION,
    environment.AWS_ACCESS_KEY_ID,
    environment.AWS_SECRET_ACCESS_KEY
  ].some(hasValue);
  validateOptionalGroup(
    environment,
    ["CURIOFLOW_PASSWORD_RESET_FROM", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
    sesEnabled,
    issues
  );
  return issues;
}

export function validateRuntimeConfiguration(environment: RuntimeEnvironment = process.env) {
  const issues = runtimeConfigurationIssues(environment);
  if (issues.length > 0) {
    throw new Error(`Invalid Curioflow runtime configuration:\n- ${issues.join("\n- ")}`);
  }
}
