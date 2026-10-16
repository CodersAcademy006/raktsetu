// One place for Temporal connection settings. Local dev / the bundled
// container use TEMPORAL_ADDRESS with no TLS; Temporal Cloud is enabled by
// setting TEMPORAL_API_KEY (plus TEMPORAL_ADDRESS and TEMPORAL_NAMESPACE).
export function temporalConnectionOptions() {
  const apiKey = process.env.TEMPORAL_API_KEY;
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  return {
    address: process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
    namespace,
    ...(apiKey ? { tls: true as const, apiKey, metadata: { "temporal-namespace": namespace } } : {}),
  };
}

export const TASK_QUEUE = "raktsetu";
