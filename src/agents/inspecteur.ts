import { AgentMessage, IncidentContext } from '../types';
import { callQwen } from '../qwenClient';

const SYSTEM_PROMPT = `Tu es L'Inspecteur, agent d'investigation forensique de SentinelOps Society.
Tu analyses les logs, metriques et historique de deploiement pour un incident de production.
Tu dois:
1. Identifier les anomalies dans les logs (patterns d'erreur, pics de latence)
2. Correlate avec les deployements recents
3. Lister les services dependants potentiellement impactes
4. Produire un rapport d'investigation detaille en francais
Tu operes en lecture seule. Tu ne modifies rien en production.
Simule des extraits de logs realistes pertinents a l'alerte recue.
Reponds en JSON: logsAnalysis (string), recentDeployments (string), impactedServices (string[]), findings (string).`;

export async function runInspecteur(
  context: IncidentContext,
  timeline: AgentMessage[]
): Promise<string> {
  console.log('[Orchestrator] Running L\'Inspecteur...');

  const userPrompt = `Alerte: ${context.alert.message}\nService: ${context.alert.service}\nClassification: ${context.classification}`;

  timeline.push({
    agent: 'L\'Inspecteur',
    role: 'user',
    content: `Investigation forensique du service: ${context.alert.service}`,
    timestamp: new Date().toISOString(),
  });

  const result = await callQwen(SYSTEM_PROMPT, userPrompt);

  timeline.push({
    agent: 'L\'Inspecteur',
    role: 'assistant',
    content: result,
    timestamp: new Date().toISOString(),
  });

  return result;
}
