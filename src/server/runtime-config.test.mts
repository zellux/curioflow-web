import assert from "node:assert/strict";
import test from "node:test";
import { runtimeConfigurationIssues } from "./runtime-config.ts";

test("production runtime requires database, HTTPS origin, and secret encryption", () => {
  assert.deepEqual(runtimeConfigurationIssues({ NODE_ENV: "production" }), [
    "DATABASE_URL is required in production.",
    "CURIOFLOW_SECRET_KEY is required in production.",
    "CURIOFLOW_APP_URL is required in production."
  ]);
  assert.deepEqual(runtimeConfigurationIssues({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://db",
    CURIOFLOW_SECRET_KEY: "secret",
    CURIOFLOW_APP_URL: "http://example.com"
  }), ["CURIOFLOW_APP_URL must use HTTPS in production."]);
});

test("optional integrations may be absent but reject partial configuration", () => {
  assert.deepEqual(runtimeConfigurationIssues({ NODE_ENV: "development" }), []);
  assert.deepEqual(runtimeConfigurationIssues({
    NODE_ENV: "development",
    CURIOFLOW_INFLUXDB_IP: "influx:8086"
  }), [
    "CURIOFLOW_INFLUXDB_USERNAME is required when this integration is configured.",
    "CURIOFLOW_INFLUXDB_PASSWORD is required when this integration is configured."
  ]);
});
