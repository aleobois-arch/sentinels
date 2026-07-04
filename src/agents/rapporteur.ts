import { AgentMessage, IncidentContext } from '../types';
import { callQwen } from '../qwenClient';

const SYSTEM_PROMPT = `Tu es Le Rapporteur, redacteur de rapports post-incident conforme aux exigences NIS2 europeennes et ANSSI francaises de SentinelOps Society.
Tu dois produire un rapport post-incident (PIR) complet incluant:
1. Resume executif (pour la direction, 3 phrases max)
2. Chronologie detaillee de l'incident
3. Analyse de cause racine validee
4. Actions de remediation appliquees
5. Mesures preventives recommandees
6. Conformite RGPD: donnees personnelles impactees (oui/non, justification)
7. Obligation de notification ANSSI (oui/non, delai reglementaire)
8. Indicateurs cles: MTTR, MTTD, disponibilite impactee en %
Le rapport doit etre en francais, professionnel, et pret a etre transmis au DSI, RSSI, ou autorites reglementaires.
Format: Markdown structure avec titres et sous-titres.`;

export async function runRapporteur(
  context: IncidentContext,
  timeline: AgentMessage[]
): Promise<string> {
  console.log('[Orchestrator] Running Le Rapporteur...');

  const userPrompt = `
INCIDENT: ${context.alert.id}
SERVICE: ${context.alert.service}
SEVERITE: ${context.alert.severity}
ALERTE: ${context.alert.message}
CLASSIFICATION: ${context.classification}
INVESTIGATION: ${context.investigation}
CAUSE RACINE: ${context.rootCause} (Confiance: ${context.confidence}%)
PLAN DE REMEDIATION: ${context.remediationPlan}
NIVEAU DE RISQUE: ${context.remediationRisk}
APPROBATION REQUISE: ${context.requiresApproval}
STATUT: ${context.approved ? 'Resolu' : 'En attente d\'approbation'}
  `;

  timeline.push({
    agent: 'Le Rapporteur',
    role: 'user',
    content: 'Generation du rapport post-incident NIS2...',
    timestamp: new Date().toISOString(),
  });

  const result = await callQwen(SYSTEM_PROMPT, userPrompt);

  timeline.push({
    agent: 'Le Rapporteur',
    role: 'assistant',
    content: 'Rapport post-incident NIS2 genere avec succes.',
    timestamp: new Date().toISOString(),
  });

  return result;
}
