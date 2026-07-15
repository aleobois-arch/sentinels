import { Alert, AgentMessage, IncidentContext, IncidentRecord, RawAlertInput } from './types';
import { runSentinelle } from './agents/sentinelle';
import { runInspecteur } from './agents/inspecteur';
import { runAnalyste } from './agents/analyste';
import { runOperateur } from './agents/operateur';
import { runRapporteur } from './agents/rapporteur';
import { decideApproval } from './policy';
import { executeTool } from './tools/registry';
import { saveIncident, getIncident, publishTimeline, publishStatus, publishEvent } from './store';

function pushTimeline(record: IncidentRecord, entry: Omit<AgentMessage, 'timestamp'>): void {
  const full: AgentMessage = { ...entry, timestamp: new Date().toISOString() };
  record.context.timeline.push(full);
  publishTimeline(record.incidentId, full);
}

/** Mirror agent-pushed timeline entries (they append directly to context.timeline) out to SSE subscribers. */
function syncNewTimelineEntries(record: IncidentRecord, previousLength: number): number {
  for (let i = previousLength; i < record.context.timeline.length; i++) {
    publishTimeline(record.incidentId, record.context.timeline[i]);
  }
  return record.context.timeline.length;
}

function createRecord(placeholderAlert: Alert): IncidentRecord {
  const now = new Date().toISOString();
  const context: IncidentContext = {
    alert: placeholderAlert,
    classification: '',
    investigation: '',
    toolInvocations: [],
    rootCause: '',
    confidence: 0,
    alternatives: [],
    remediationPlan: '',
    actions: [],
    rollbackPlan: '',
    remediationRisk: 'moyen',
    approvalLevel: 'dsi',
    approvalReason: '',
    requiresApproval: true,
    approved: false,
    executionResults: [],
    postIncidentReport: '',
    timeline: [],
    usage: { promptTokens: 0, completionTokens: 0, calls: 0 },
  };
  return {
    incidentId: `INC-${Date.now()}`,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    context,
    durationMs: 0,
  };
}

/**
 * Phase 1 — Triage & diagnosis (agents 1 → 4), then the policy gate.
 *
 * Low-risk incidents are remediated automatically; anything else stops at a
 * human-in-the-loop checkpoint (`pending_approval`) until a DSI/RSSI decision
 * arrives through the /approve or /reject API.
 *
 * Returns the record synchronously (with its incidentId) and runs the
 * pipeline in the background; clients follow progress via SSE or polling.
 */
export function startIncidentPipeline(input: Alert | RawAlertInput): IncidentRecord {
  const placeholder: Alert =
    'rawText' in input
      ? { id: `ALT-${Date.now()}`, service: 'en cours de normalisation...', message: input.rawText.slice(0, 200), timestamp: new Date().toISOString(), severity: 'P2', source: input.source }
      : input;

  const record = createRecord(placeholder);
  saveIncident(record);
  void runPipeline(record, input).catch((err) =>
    console.error(`[Orchestrator] Unhandled pipeline error for ${record.incidentId}:`, err?.message)
  );
  return record;
}

async function runPipeline(record: IncidentRecord, input: Alert | RawAlertInput): Promise<void> {
  const startTime = Date.now();
  const ctx = record.context;

  try {
    console.log(`[Orchestrator] Starting incident ${record.incidentId}`);
    let seen = 0;

    // Step 1: Le Sentinelle — classification + normalization of ambiguous input
    const sentinelle = await runSentinelle(input, ctx.timeline, ctx.usage);
    ctx.classification = sentinelle.classification;
    ctx.alert = sentinelle.normalizedAlert;
    seen = syncNewTimelineEntries(record, seen);
    saveIncident(record);

    // Step 2: L'Inspecteur — tool-driven forensic investigation
    ctx.investigation = await runInspecteur(ctx, ctx.timeline, ctx.usage);
    seen = syncNewTimelineEntries(record, seen);
    saveIncident(record);

    // Step 3: L'Analyste — root cause analysis
    const analyse = await runAnalyste(ctx, ctx.timeline, ctx.usage);
    ctx.rootCause = analyse.rootCause;
    ctx.confidence = analyse.confidence;
    ctx.alternatives = analyse.alternatives;
    seen = syncNewTimelineEntries(record, seen);
    saveIncident(record);

    // Step 4: L'Operateur — remediation plan + executable actions
    const remediation = await runOperateur(ctx, ctx.timeline, ctx.usage);
    ctx.remediationPlan = remediation.plan;
    ctx.actions = remediation.actions;
    ctx.remediationRisk = remediation.risk;
    ctx.rollbackPlan = remediation.rollbackPlan;
    seen = syncNewTimelineEntries(record, seen);

    // Policy gate — deterministic code decides, not the LLM
    const decision = decideApproval(ctx.remediationRisk, ctx.alert.severity, ctx.confidence);
    ctx.approvalLevel = decision.approvalLevel;
    ctx.approvalReason = decision.reason;
    ctx.requiresApproval = decision.requiresApproval;

    pushTimeline(record, {
      agent: 'Moteur de Politique',
      role: 'assistant',
      content: decision.reason,
    });

    if (!decision.requiresApproval) {
      ctx.approved = true;
      await executeAndReport(record, 'auto-approbation (politique)');
    } else {
      record.status = 'pending_approval';
      record.durationMs = Date.now() - startTime;
      saveIncident(record);
      publishStatus(record.incidentId, 'pending_approval');
      pushTimeline(record, {
        agent: 'Systeme',
        role: 'assistant',
        content: `⏸ CHECKPOINT HUMAIN — Approbation ${decision.approvalLevel === 'rssi_dsi' ? 'RSSI + DSI' : 'DSI'} requise. En attente de decision via POST /incident/${record.incidentId}/approve ou /reject.`,
      });
      publishEvent(record.incidentId, { type: 'done', data: summarize(record) });
      console.log(`[Orchestrator] Incident ${record.incidentId} awaiting human approval.`);
    }
  } catch (error: any) {
    console.error(`[Orchestrator] Incident ${record.incidentId} failed:`, error.message);
    record.status = 'failed';
    pushTimeline(record, { agent: 'Systeme', role: 'assistant', content: `Echec du pipeline: ${error.message}` });
    saveIncident(record);
    publishStatus(record.incidentId, 'failed');
    publishEvent(record.incidentId, { type: 'error', data: error.message });
  }

  record.durationMs = Date.now() - startTime;
  saveIncident(record);
}

/** Phase 2 — Execution of the approved actions + post-incident report. */
async function executeAndReport(record: IncidentRecord, decisionBy: string): Promise<void> {
  const ctx = record.context;
  record.status = 'executing';
  saveIncident(record);
  publishStatus(record.incidentId, 'executing');

  for (const action of ctx.actions) {
    pushTimeline(record, {
      agent: 'L\'Operateur',
      role: 'tool',
      content: `Execution: ${action.tool}(${JSON.stringify(action.args)}) — ${action.rationale}`,
    });
    await executeTool(action.tool, action.args, ctx.alert, ctx.executionResults);
    const last = ctx.executionResults[ctx.executionResults.length - 1];
    pushTimeline(record, {
      agent: 'L\'Operateur',
      role: 'assistant',
      content: `Resultat ${action.tool}: ${last?.result.slice(0, 300)}`,
    });
  }

  if (ctx.actions.length === 0) {
    pushTimeline(record, {
      agent: 'Systeme',
      role: 'assistant',
      content: 'Aucune action executable proposee — remediation manuelle documentee dans le rapport.',
    });
  }

  const seen = ctx.timeline.length;
  ctx.postIncidentReport = await runRapporteur(ctx, ctx.timeline, ctx.usage, `resolu (${decisionBy})`);
  syncNewTimelineEntries(record, seen);

  record.status = 'resolved';
  saveIncident(record);
  publishStatus(record.incidentId, 'resolved');
  publishEvent(record.incidentId, { type: 'done', data: summarize(record) });
  console.log(`[Orchestrator] Incident ${record.incidentId} resolved (${decisionBy}).`);
}

/** Human decision: approve. Runs the execution phase then the report. */
export async function approveIncident(incidentId: string, approver: string): Promise<IncidentRecord> {
  const record = getIncident(incidentId);
  if (!record) throw new Error(`Incident inconnu: ${incidentId}`);
  if (record.status !== 'pending_approval') {
    throw new Error(`L'incident ${incidentId} n'est pas en attente d'approbation (statut: ${record.status}).`);
  }
  record.context.approved = true;
  record.approver = approver;
  pushTimeline(record, {
    agent: 'Humain (HITL)',
    role: 'user',
    content: `✔ Remediation APPROUVEE par ${approver}. Lancement de l'execution.`,
  });
  await executeAndReport(record, `approbation humaine: ${approver}`);
  return record;
}

/** Human decision: reject. No execution; the report documents the refusal. */
export async function rejectIncident(incidentId: string, approver: string, reason: string): Promise<IncidentRecord> {
  const record = getIncident(incidentId);
  if (!record) throw new Error(`Incident inconnu: ${incidentId}`);
  if (record.status !== 'pending_approval') {
    throw new Error(`L'incident ${incidentId} n'est pas en attente d'approbation (statut: ${record.status}).`);
  }
  record.context.approved = false;
  record.approver = approver;
  record.decisionNote = reason;
  pushTimeline(record, {
    agent: 'Humain (HITL)',
    role: 'user',
    content: `✖ Remediation REFUSEE par ${approver}. Motif: ${reason || 'non precise'}. Aucune action ne sera executee.`,
  });

  const ctx = record.context;
  const seen = ctx.timeline.length;
  ctx.postIncidentReport = await runRapporteur(ctx, ctx.timeline, ctx.usage, `rejete par ${approver}: ${reason}`);
  syncNewTimelineEntries(record, seen);

  record.status = 'rejected';
  saveIncident(record);
  publishStatus(record.incidentId, 'rejected');
  publishEvent(record.incidentId, { type: 'done', data: summarize(record) });
  return record;
}

export function summarize(record: IncidentRecord) {
  return {
    incidentId: record.incidentId,
    status: record.status,
    service: record.context.alert.service,
    severity: record.context.alert.severity,
    rootCause: record.context.rootCause,
    confidence: record.context.confidence,
    risk: record.context.remediationRisk,
    approvalLevel: record.context.approvalLevel,
    approver: record.approver,
    durationMs: record.durationMs,
    usage: record.context.usage,
    toolCalls: record.context.toolInvocations.length,
    actionsExecuted: record.context.executionResults.length,
  };
}
