import OpenAI from 'openai';
import { Alert, ToolInvocation } from '../types';

/**
 * Tool registry exposed to the agents through Qwen native function calling.
 *
 * The executors below are deterministic simulators so the project can be
 * evaluated end-to-end without live infrastructure. Each simulator is an
 * adapter seam: in production, swap its body for the real Alibaba Cloud API
 * (SLS GetLogs for `get_logs`, CloudMonitor DescribeMetricList for
 * `get_metrics`, ROS/ACK APIs for the remediation tools) without touching
 * the agents or the orchestrator.
 */

// ---------------------------------------------------------------------------
// Observability tools (read-only — used by L'Inspecteur)
// ---------------------------------------------------------------------------

export const OBSERVABILITY_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_logs',
      description:
        'Recupere les logs applicatifs recents du service (equivalent production: Alibaba Cloud SLS GetLogs).',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Nom du service' },
          minutes: { type: 'number', description: 'Fenetre de temps en minutes (defaut 30)' },
        },
        required: ['service'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_metrics',
      description:
        'Recupere les metriques systeme et applicatives du service: CPU, memoire, latence p99, taux d\'erreur, connexions DB (equivalent production: Alibaba CloudMonitor).',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Nom du service' },
        },
        required: ['service'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_deployments',
      description: 'Liste les derniers deploiements du service avec versions et horodatages.',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Nom du service' },
        },
        required: ['service'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_service_dependencies',
      description: 'Retourne la carte des dependances amont/aval du service (service mesh).',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string', description: 'Nom du service' },
        },
        required: ['service'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Remediation tools (write — executed only after the policy/HITL gate)
// ---------------------------------------------------------------------------

export const REMEDIATION_TOOL_NAMES = [
  'restart_service',
  'rollback_deployment',
  'scale_service',
  'clear_cache',
  'failover_region',
] as const;

export type RemediationToolName = (typeof REMEDIATION_TOOL_NAMES)[number];

export function isRemediationTool(name: string): name is RemediationToolName {
  return (REMEDIATION_TOOL_NAMES as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Deterministic simulation helpers (stable output for a given alert => stable demos)
// ---------------------------------------------------------------------------

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

interface Scenario {
  kind: 'db_pool' | 'memory_leak' | 'latency' | 'disk' | 'generic';
}

/** Infer a coherent failure scenario from the alert wording, so logs/metrics/deployments tell one consistent story. */
function inferScenario(alert: Alert): Scenario {
  const text = alert.message.toLowerCase();
  if (/(pool|connexion|connection|postgres|database|db|sql)/.test(text)) return { kind: 'db_pool' };
  if (/(memoire|memory|oom|heap|leak)/.test(text)) return { kind: 'memory_leak' };
  if (/(latence|latency|lent|slow|timeout|p99)/.test(text)) return { kind: 'latency' };
  if (/(disque|disk|storage|espace|volume)/.test(text)) return { kind: 'disk' };
  return { kind: 'generic' };
}

function simulateLogs(alert: Alert, minutes: number): string {
  const scenario = inferScenario(alert);
  const base = new Date(Date.parse(alert.timestamp) || Date.now());
  const line = (offsetSec: number, level: string, msg: string) => {
    const t = new Date(base.getTime() - offsetSec * 1000).toISOString();
    return `${t} [${level}] ${alert.service} — ${msg}`;
  };

  const patterns: Record<Scenario['kind'], string[]> = {
    db_pool: [
      line(840, 'INFO', 'Deployment v2.14.3 rollout complete (replicas 6/6)'),
      line(750, 'WARN', 'connection pool usage at 100% (5/5 active)'),
      line(720, 'ERROR', 'connection pool exhausted, request waited 5000ms before timeout'),
      line(600, 'ERROR', 'FATAL: remaining connection slots are reserved for superuser'),
      line(300, 'ERROR', 'HTTP 500 — upstream database unavailable (x412 occurrences)'),
      line(60, 'ERROR', 'circuit breaker OPEN for datasource primary'),
    ],
    memory_leak: [
      line(3600, 'WARN', 'heap usage 71% and climbing steadily since last deploy'),
      line(1800, 'WARN', 'GC pause 1.2s (old gen 92%)'),
      line(600, 'ERROR', 'OutOfMemoryError: Java heap space in OrderCacheWarmer'),
      line(300, 'ERROR', 'container killed (OOMKilled), restart count = 4'),
    ],
    latency: [
      line(1200, 'INFO', 'traffic +38% vs baseline (campagne marketing detectee)'),
      line(900, 'WARN', 'p99 latency 3.1s (SLO: 800ms)'),
      line(420, 'WARN', 'thread pool queue depth 850/1000'),
      line(120, 'ERROR', 'upstream timeout after 10s on /api/v1/checkout (x287)'),
    ],
    disk: [
      line(7200, 'WARN', 'disk usage /var/data at 88%'),
      line(1800, 'WARN', 'disk usage /var/data at 97%'),
      line(300, 'ERROR', 'IOException: No space left on device — write failed'),
    ],
    generic: [
      line(600, 'WARN', 'error rate above threshold (baseline x6)'),
      line(300, 'ERROR', `unhandled exception burst correlated with alert: ${alert.message.slice(0, 80)}`),
    ],
  };

  return JSON.stringify({
    query: { service: alert.service, window_minutes: minutes },
    total_matches: 400 + (hashString(alert.id) % 300),
    sample_lines: patterns[scenario.kind],
  });
}

function simulateMetrics(alert: Alert): string {
  const scenario = inferScenario(alert);
  const seed = hashString(alert.service);
  const metricsByScenario: Record<Scenario['kind'], object> = {
    db_pool: {
      cpu_percent: 34,
      memory_percent: 51,
      p99_latency_ms: 8400,
      error_rate_percent: 41.7,
      db_pool_active: 5,
      db_pool_max: 5,
      db_pool_waiting: 312,
      note: 'Pool DB sature: 5/5 connexions actives (baseline habituelle: 50 max). File d attente en croissance.',
    },
    memory_leak: {
      cpu_percent: 62,
      memory_percent: 96,
      p99_latency_ms: 2900,
      error_rate_percent: 12.3,
      oom_kills_last_hour: 4,
      note: 'Memoire en croissance lineaire depuis le dernier deploiement — fuite probable.',
    },
    latency: {
      cpu_percent: 91,
      memory_percent: 68,
      p99_latency_ms: 3100,
      error_rate_percent: 8.9,
      requests_per_second: 1850 + (seed % 400),
      note: 'CPU sature sous un trafic +38% vs baseline. Autoscaling non declenche (plafond replicas atteint).',
    },
    disk: {
      cpu_percent: 22,
      memory_percent: 47,
      p99_latency_ms: 950,
      error_rate_percent: 17.2,
      disk_usage_percent: 99,
      note: 'Volume de donnees plein a 99% — ecritures en echec.',
    },
    generic: {
      cpu_percent: 48,
      memory_percent: 60,
      p99_latency_ms: 1600,
      error_rate_percent: 9.5,
      note: 'Anomalie du taux d erreur sans saturation systeme evidente.',
    },
  };
  return JSON.stringify({ service: alert.service, window: 'last_30m', metrics: metricsByScenario[scenario.kind] });
}

function simulateDeployments(alert: Alert): string {
  const scenario = inferScenario(alert);
  const base = new Date(Date.parse(alert.timestamp) || Date.now());
  const minutesAgo = (m: number) => new Date(base.getTime() - m * 60_000).toISOString();
  const recentDeploy = scenario.kind === 'db_pool' || scenario.kind === 'memory_leak';
  return JSON.stringify({
    service: alert.service,
    deployments: [
      {
        version: 'v2.14.3',
        deployed_at: recentDeploy ? minutesAgo(14) : minutesAgo(2880),
        author: 'ci-pipeline',
        changelog: recentDeploy
          ? 'Migration du client DB + nouveaux parametres de pool de connexions'
          : 'Correctifs mineurs et dependances',
        status: 'active',
      },
      { version: 'v2.14.2', deployed_at: minutesAgo(8640), author: 'ci-pipeline', changelog: 'Patch securite TLS', status: 'previous_stable' },
      { version: 'v2.14.1', deployed_at: minutesAgo(20160), author: 'ci-pipeline', changelog: 'Refonte du module facturation', status: 'archived' },
    ],
  });
}

function simulateDependencies(alert: Alert): string {
  return JSON.stringify({
    service: alert.service,
    upstream: ['gateway-api', 'auth-service'],
    downstream: ['postgres-primary', 'redis-cache', 'psp-connector'],
    consumers_impacted: ['checkout-web', 'facturation-batch', 'mobile-app-bff'],
  });
}

function simulateRemediation(name: string, args: Record<string, unknown>): string {
  const service = String(args.service ?? 'unknown-service');
  switch (name) {
    case 'restart_service':
      return JSON.stringify({ status: 'success', action: 'restart', service, details: 'Rolling restart 6/6 replicas termine en 74s. Health checks OK.' });
    case 'rollback_deployment':
      return JSON.stringify({ status: 'success', action: 'rollback', service, target_version: args.version ?? 'previous_stable', details: 'Rollback applique. Taux d erreur retombe a 0.3% apres 3 minutes.' });
    case 'scale_service':
      return JSON.stringify({ status: 'success', action: 'scale', service, replicas: args.replicas ?? 10, details: 'Scaling applique. CPU moyen retombe a 55%.' });
    case 'clear_cache':
      return JSON.stringify({ status: 'success', action: 'clear_cache', service, details: 'Cache purge. Taux de hit reconstruit a 91% en 5 minutes.' });
    case 'failover_region':
      return JSON.stringify({ status: 'success', action: 'failover', service, target_region: args.region ?? 'eu-central-1', details: 'Trafic bascule vers la region secondaire. RTO observe: 2m10s.' });
    default:
      return JSON.stringify({ status: 'error', details: `Outil inconnu: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a tool by name and record the invocation.
 * `invocations` receives an audit entry for every call (shown in the dashboard timeline).
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  alert: Alert,
  invocations: ToolInvocation[]
): Promise<string> {
  const startedAt = Date.now();
  let result: string;
  switch (name) {
    case 'get_logs':
      result = simulateLogs(alert, Number(args.minutes ?? 30));
      break;
    case 'get_metrics':
      result = simulateMetrics(alert);
      break;
    case 'get_recent_deployments':
      result = simulateDeployments(alert);
      break;
    case 'get_service_dependencies':
      result = simulateDependencies(alert);
      break;
    default:
      if (isRemediationTool(name)) {
        result = simulateRemediation(name, args);
      } else {
        result = JSON.stringify({ status: 'error', details: `Outil non enregistre: ${name}` });
      }
  }
  invocations.push({
    tool: name,
    args,
    result,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  });
  return result;
}
