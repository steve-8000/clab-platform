import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

export function initMetrics(serviceName: string): MeterProvider {
  const exporter = new OTLPMetricExporter({
    url:
      process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
      "http://localhost:4318/v1/metrics",
  });

  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 30_000,
  });

  const provider = new MeterProvider({
    resource: new Resource({ [ATTR_SERVICE_NAME]: serviceName }),
    readers: [reader],
  });

  return provider;
}
