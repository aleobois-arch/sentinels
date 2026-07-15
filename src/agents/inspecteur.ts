import { AgentMessage, IncidentContext, TokenUsage } from '../types';
import { callQwenWithTools, isMockMode, accumulateUsage } from '../qwenClient';
import { getMock } from '../mocks';
import { OBSERVABILITY_TOOLS, executeTool } from '../tools/registry';

const SYSTEM_PROMPT = `Tu es L'Inspecteur, agent d'investigation forensique de SentinelOps Society.
Tu disposes d'outils d'observabilite REELS (logs, metriques, deploiements, dependances).
Ta methode d'investigation:
1. Appelle get_logs pour identifier les patterns d'erreur
2. Appelle get_metrics pour verifier les saturations (CPU, memoire, pool DB, latence)
3. Appelle get_recent_deployments pour correler avec les changements recents
4. Appelle get_service_dependencies si tu suspectes un impact en cascade
Tu operes en LECTURE SEULE. Tu ne modifies rien en production.
Croise les resultats des outils avant de conclure — une correlation temporelle
deploiement/incident est un signal fort.
Quand tu as suffisamment d'elements, produis ta reponse finale UNIQUEMENT en JSON:
{ "logsAnalysis": string, "recentDeployments": string, "impactedServices": [string], "findings": string }`;

/**
 * Forensic investigation through a real agentic tool loop: Qwen decides which
 * observability tools to call (function calling), we execute them, and every
 * invocation is recorded in the incident's audit trail.
 */
export async function runInspecteur(
  context: IncidentContext,
  timeline: AgentMessage[],
  usage: TokenUsage
): Promise<string> {
  console.log('[Orchestrator] Running L\'Inspecteur...');

  timeline.push({
    agent: 'L\'Inspecteur',
    role: 'user',
    content: `Investigation forensique outillee du service: ${context.alert.service}`,
    timestamp: new Date().toISOString(),
  });

  let result: string;

  if (isMockMode()) {
    // Offline demo: execute a realistic scripted tool sequence through the
    // real executors so the audit trail and dashboard behave exactly as live.
    for (const call of [
      { name: 'get_logs', args: { service: context.alert.service, minutes: 30 } },
      { name: 'get_metrics', args: { service: context.alert.service } },
      { name: 'get_recent_deployments', args: { service: context.alert.service } },
    ]) {
      await executeTool(call.name, call.args, context.alert, context.toolInvocations);
      timeline.push({
        agent: 'L\'Inspecteur',
        role: 'tool',
        content: `Outil ${call.name}(${JSON.stringify(call.args)}) execute.`,
        timestamp: new Date().toISOString(),
      });
    }
    result = getMock('inspecteur_summary');
  } else {
    const before = context.toolInvocations.length;
    const loop = await callQwenWithTools(
      'inspecteur',
      SYSTEM_PROMPT,
      `Alerte: ${context.alert.message}\nService: ${context.alert.service}\nSeverite: ${context.alert.severity}\nClassification: ${context.classification}`,
      OBSERVABILITY_TOOLS,
      (name, args) => {
        timeline.push({
          agent: 'L\'Inspecteur',
          role: 'tool',
          content: `Appel outil: ${name}(${JSON.stringify(args)})`,
          timestamp: new Date().toISOString(),
        });
        return executeTool(name, args, context.alert, context.toolInvocations);
      },
      { maxRounds: 6 }
    );
    accumulateUsage(usage, loop.usage);
    result = loop.content;
    console.log(`[Inspecteur] Investigation done with ${context.toolInvocations.length - before} tool calls.`);
  }

  timeline.push({
    agent: 'L\'Inspecteur',
    role: 'assistant',
    content: result,
    timestamp: new Date().toISOString(),
  });

  return result;
}
