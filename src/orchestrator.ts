import { Alert, IncidentContext, OrchestratorResult } from './types';
import { runSentinelle } from './agents/sentinelle';
import { runInspecteur } from './agents/inspecteur';
import { runAnalyste } from './agents/analyste';
import { runOperateur } from './agents/operateur';
import { runRapporteur } from './agents/rapporteur';

export async function runOrchestrator(alert: Alert): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const incidentId = `INC-${Date.now()}`;
  console.log(`[Orchestrator] Starting incident ${incidentId} for service: ${alert.service}`);

  const context: IncidentContext = {
    alert,
    classification: '',
    investigation: '',
    rootCause: '',
    confidence: 0,
    remediationPlan: '',
    remediationRisk: 'moyen',
    requiresApproval: true,
    approved: false,
    postIncidentReport: '',
    timeline: [],
  };

  // Step 1: Le Sentinelle - Alert classification
  console.log('[Orchestrator] Step 1: Le Sentinelle');
  context.classification = await runSentinelle(alert, context.timeline);

  // Step 2: L'Inspecteur - Forensic investigation
  console.log('[Orchestrator] Step 2: L\'Inspecteur');
  context.investigation = await runInspecteur(context, context.timeline);

  // Step 3: L'Analyste - Root cause analysis
  console.log('[Orchestrator] Step 3: L\'Analyste');
  const { rootCause, confidence } = await runAnalyste(context, context.timeline);
  context.rootCause = rootCause;
  context.confidence = confidence;

  // Step 4: L'Operateur - Remediation plan
  console.log('[Orchestrator] Step 4: L\'Operateur');
  const { plan, risk, requiresApproval } = await runOperateur(context, context.timeline);
  context.remediationPlan = plan;
  context.remediationRisk = risk;
  context.requiresApproval = requiresApproval;

  let status: 'resolved' | 'pending_approval' | 'failed' = 'pending_approval';

  if (!requiresApproval) {
    context.approved = true;
    status = 'resolved';
    context.timeline.push({
      agent: 'Systeme',
      role: 'assistant',
      content: `Remediation executee automatiquement (risque: ${risk}). Service restaure.`,
      timestamp: new Date().toISOString(),
    });
    console.log('[Orchestrator] Auto-remediation executed.');
  } else {
    context.timeline.push({
      agent: 'Systeme',
      role: 'assistant',
      content: `Approbation humaine requise (risque: ${risk}). En attente de validation DSI/RSSI.`,
      timestamp: new Date().toISOString(),
    });
    console.log('[Orchestrator] Human approval required.');
  }

  // Step 5: Le Rapporteur - Post-incident report
  console.log('[Orchestrator] Step 5: Le Rapporteur');
  context.postIncidentReport = await runRapporteur(context, context.timeline);

  const durationMs = Date.now() - startTime;
  console.log(`[Orchestrator] Incident ${incidentId} processed in ${durationMs}ms`);

  return { incidentId, context, status, durationMs };
}
