import type { KanectaApiClient } from '@kanecta/api-client';
import type {
  IntegrityReport,
  IntegrityEvent,
  IntegrityCheckResult,
  IntegritySummary,
  IntegrityQuery,
} from '@kanecta/api-client';

export type {
  IntegrityReport,
  IntegrityEvent,
  IntegrityCheckResult,
  IntegritySummary,
  IntegrityQuery,
};

export function integrityApi(client: KanectaApiClient) {
  return {
    report: (query?: IntegrityQuery) => client.integrity.report(query),
    streamUrl: (query?: IntegrityQuery) => client.integrity.streamUrl(query),
    stream: (query?: IntegrityQuery) => client.integrity.stream(query),
  };
}
