import { AgentMessage, IncidentContext, TokenUsage } from '../types';
import { callQwen, accumulateUsage } from '../qwenClient';

const SYSTEM_PROMPT = `Tu es Le Rapporteur, redacteur de rapports post-incident conforme aux exigences NIS2 europeennes et ANSSI francaises de SentinelOps Society.
Tu dois produire un rapport post-incident (PIR) complet incluant:
1. Resume executif (pour la direction, 3 phrases max)
2. Chronologie detaillee de l'incident (inclus les appels d'outils d'observabilite et la decision d'approbation humaine)
3. Analyse de cause racine validee (avec hypotheses alternatives ecartees)
4. Actions de remediation appliquees (ou refusees, avec le motif)
5. Mesures preventives recommandees
6. Conformite RGPD: donnees personnelles impactees (oui/non, justification)
7. Obligation de notification ANSSI / NIS2 Art. 23 (oui/non, delais: alerte precoce 24h, notification 72h, rapport final 1 mois)
8. Indicateurs cles: MTTR, MTTD, disponibilite impactee en %
Le rapport doit etre en francais, professionnel, et pret a etre transmis au DSI, RSSI, ou autorites reglementaires.
Format: Markdown structure avec titres et sous-titres.`;

export async function runRapporteur(
  context: IncidentContext,
  timeline: AgentMessage[],
  usage: TokenUsage,
  finalStatus: string
): Promise<string> {
  console.log('[Orchestrator] Running Le Rapporteur...');

  const executionSummary = context.executionResults.length
    ? context.executionResults.map((r) => `- ${r.tool}(${JSON.stringify(r.args)}) => ${r.result.slice(0, 200)}`).join('\n')
    : 'Aucune action executee.';

  const userPrompt = `
INCIDENT: ${context.alert.id}
SERVICE: ${context.alert.service}
SEVERITE: ${context.alert.severity}
SOURCE DE L'ALERTE: ${context.alert.source || 'structuree'}
ALERTE: ${context.alert.message}
CLASSIFICATION: ${context.classification}
INVESTIGATION: ${context.investigation}
OUTILS D'OBSERVABILITE APPELES: ${context.toolInvocations.map((t) => t.tool).join(', ') || 'aucun'}
CAUSE RACINE: ${context.rootCause} (Confiance: ${context.confidence}%)
HYPOTHESES ALTERNATIVES ECARTEES: ${context.alternatives.join(' | ') || 'aucune'}
PLAN DE REMEDIATION: ${context.remediationPlan}
PLAN DE ROLLBACK: ${context.rollbackPlan}
NIVEAU DE RISQUE: ${context.remediationRisk}
DECISION DE POLITIQUE: ${context.approvalReason} (niveau: ${context.approvalLevel})
STATUT FINAL: ${finalStatus}
ACTIONS EXECUTEES:
${executionSummary}
  `;

  timeline.push({
    agent: 'Le Rapporteur',
    role: 'user',
    content: 'Generation du rapport post-incident NIS2/ANSSI...',
    timestamp: new Date().toISOString(),
  });

  const response = await callQwen('rapporteur', SYSTEM_PROMPT, userPrompt, { maxTokens: 3000 });
  accumulateUsage(usage, response.usage);

  timeline.push({
    agent: 'Le Rapporteur',
    role: 'assistant',
    content: 'Rapport post-incident NIS2 genere avec succes.',
    timestamp: new Date().toISOString(),
  });

  return response.content;
}
