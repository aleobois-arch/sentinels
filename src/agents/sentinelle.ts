import { Alert, AgentMessage, IncidentContext } from '../types';
import { callQwen } from '../qwenClient';

const SYSTEM_PROMPT = `Tu es Le Sentinelle, agent de surveillance operationnelle de SentinelOps Society.
Tu recois une alerte de production et tu dois:
1. Confirmer la severite ANSSI (P1 critique / P2 majeur / P3 modere / P4 mineur)
2. Identifier le service impacte
3. Estimer le perimetre d'impact (utilisateurs, revenus, SLA)
4. Rediger une classification structuree en francais
Reponds en JSON avec les champs: severity, service, impact, classification, perimetre.`;

export async function runSentinelle(
  alert: Alert,
  timeline: AgentMessage[]
): Promise<string> {
  console.log('[Orchestrator] Running Le Sentinelle...');

  timeline.push({
    agent: 'Le Sentinelle',
    role: 'user',
    content: `Analyse de l'alerte: ${alert.message} (Severite declaree: ${alert.severity})`,
    timestamp: new Date().toISOString(),
  });

  const result = await callQwen(SYSTEM_PROMPT, JSON.stringify(alert));

  timeline.push({
    agent: 'Le Sentinelle',
    role: 'assistant',
    content: result,
    timestamp: new Date().toISOString(),
  });

  return result;
}
