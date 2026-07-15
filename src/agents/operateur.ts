import { AgentMessage, IncidentContext, RemediationAction, Risk, TokenUsage } from '../types';
import { callQwen, extractJson, accumulateUsage } from '../qwenClient';
import { REMEDIATION_TOOL_NAMES, isRemediationTool } from '../tools/registry';

const SYSTEM_PROMPT = `Tu es L'Operateur, agent de remediation certifie de SentinelOps Society.
Sur la base de l'analyse de cause racine, tu dois:
1. Proposer un plan de remediation etape par etape (lisible par un humain)
2. Traduire ce plan en actions MACHINE-EXECUTABLES, limitees STRICTEMENT aux outils autorises:
   ${REMEDIATION_TOOL_NAMES.join(', ')}
   - restart_service(service)
   - rollback_deployment(service, version)
   - scale_service(service, replicas)
   - clear_cache(service)
   - failover_region(service, region)
3. Evaluer le risque global: faible / moyen / critique
4. Prevoir un plan de rollback en cas d'echec
NOTE: la decision d'execution automatique ou d'approbation humaine N'EST PAS la tienne —
elle est prise par le moteur de politique de SentinelOps. Evalue le risque honnetement.
Reponds UNIQUEMENT en JSON avec les champs:
{ "plan": string,
  "actions": [ { "tool": string, "args": object, "rationale": string } ],
  "risk": "faible" | "moyen" | "critique",
  "rollbackPlan": string,
  "estimatedDowntime": string }`;

export interface OperateurResult {
  plan: string;
  actions: RemediationAction[];
  risk: Risk;
  rollbackPlan: string;
}

export async function runOperateur(
  context: IncidentContext,
  timeline: AgentMessage[],
  usage: TokenUsage
): Promise<OperateurResult> {
  console.log('[Orchestrator] Running L\'Operateur...');

  const userPrompt = `Cause racine: ${context.rootCause}\nConfiance: ${context.confidence}%\nService: ${context.alert.service}\nSeverite: ${context.alert.severity}\nInvestigation: ${context.investigation.slice(0, 1200)}`;

  timeline.push({
    agent: 'L\'Operateur',
    role: 'user',
    content: 'Elaboration du plan de remediation et des actions executables...',
    timestamp: new Date().toISOString(),
  });

  const response = await callQwen('operateur', SYSTEM_PROMPT, userPrompt);
  accumulateUsage(usage, response.usage);

  const parsed = extractJson<{
    plan?: string;
    actions?: Array<{ tool?: string; args?: Record<string, unknown>; rationale?: string }>;
    risk?: string;
    rollbackPlan?: string;
  }>(response.content, {});

  const plan = parsed.plan || response.content.slice(0, 500);
  const validRisks: Risk[] = ['faible', 'moyen', 'critique'];
  const risk: Risk = validRisks.includes(parsed.risk as Risk) ? (parsed.risk as Risk) : 'moyen';
  const rollbackPlan = parsed.rollbackPlan || 'Aucun plan de rollback fourni — escalade manuelle en cas d\'echec.';

  // Guardrail: silently drop any action referencing a tool outside the
  // registry. The LLM cannot invent new write-paths into production.
  const actions: RemediationAction[] = (Array.isArray(parsed.actions) ? parsed.actions : [])
    .filter((a) => a && typeof a.tool === 'string' && isRemediationTool(a.tool))
    .map((a) => ({
      tool: a.tool as string,
      args: { service: context.alert.service, ...(a.args ?? {}) },
      rationale: a.rationale || '',
    }));

  timeline.push({
    agent: 'L\'Operateur',
    role: 'assistant',
    content: `Plan de remediation (Risque: ${risk}) — ${actions.length} action(s) executable(s): ${actions.map((a) => a.tool).join(', ') || 'aucune'}`,
    timestamp: new Date().toISOString(),
  });

  return { plan, actions, risk, rollbackPlan };
}
