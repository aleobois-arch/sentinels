import { AgentMessage, IncidentContext } from '../types';
import { callQwen } from '../qwenClient';

const SYSTEM_PROMPT = `Tu es L'Operateur, agent de remediation certifie de SentinelOps Society.
Sur la base de l'analyse de cause racine, tu dois:
1. Proposer un plan de remediation etape par etape
2. Evaluer le risque global: faible / moyen / critique
3. Indiquer si une approbation humaine est requise
   - faible: execution automatique autorisee
   - moyen: approbation DSI requise
   - critique: approbation RSSI + DSI requise
4. Prevoir un plan de rollback en cas d'echec
Reponds en JSON avec les champs:
- plan: string (etapes de remediation)
- risk: 'faible' | 'moyen' | 'critique'
- requiresApproval: boolean
- rollbackPlan: string
- estimatedDowntime: string`;

export async function runOperateur(
  context: IncidentContext,
  timeline: AgentMessage[]
): Promise<{ plan: string; risk: 'faible' | 'moyen' | 'critique'; requiresApproval: boolean }> {
  console.log('[Orchestrator] Running L\'Operateur...');

  const userPrompt = `Cause racine: ${context.rootCause}\nConfiance: ${context.confidence}%\nService: ${context.alert.service}\nSeverite: ${context.alert.severity}`;

  timeline.push({
    agent: 'L\'Operateur',
    role: 'user',
    content: 'Elaboration du plan de remediation...',
    timestamp: new Date().toISOString(),
  });

  const result = await callQwen(SYSTEM_PROMPT, userPrompt);

  let plan = result;
  let risk: 'faible' | 'moyen' | 'critique' = 'moyen';
  let requiresApproval = true;

  try {
    const cleaned = result.replace(/```json\n?|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    plan = parsed.plan || result;
    risk = parsed.risk || 'moyen';
    requiresApproval = risk !== 'faible';
  } catch {
    plan = result.substring(0, 500);
  }

  timeline.push({
    agent: 'L\'Operateur',
    role: 'assistant',
    content: `Plan de remediation (Risque: ${risk}) - Approbation requise: ${requiresApproval}`,
    timestamp: new Date().toISOString(),
  });

  return { plan, risk, requiresApproval };
}
