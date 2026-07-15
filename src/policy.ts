import { ApprovalLevel, Risk, Severity } from './types';

export interface ApprovalDecision {
  approvalLevel: ApprovalLevel;
  requiresApproval: boolean;
  reason: string;
}

/**
 * Deterministic escalation policy — the guardrail between the LLM and production.
 *
 * The LLM *proposes* (risk level, remediation plan); this policy *disposes*.
 * Auto-execution is only ever granted by this code path, never by model output
 * alone, so a hallucinated "risk: faible" on a P1 incident still goes through
 * a human checkpoint.
 *
 *   risk critique ............................ RSSI + DSI approval
 *   risk moyen ................................ DSI approval
 *   risk faible + severity P1 ................. DSI approval (P1 never auto-runs)
 *   risk faible + confidence < 70 ............. DSI approval (uncertain diagnosis)
 *   risk faible + P2/P3/P4 + confidence >= 70 . auto-execution
 */
export function decideApproval(risk: Risk, severity: Severity, confidence: number): ApprovalDecision {
  if (risk === 'critique') {
    return {
      approvalLevel: 'rssi_dsi',
      requiresApproval: true,
      reason: 'Risque critique: double approbation RSSI + DSI requise par la politique de securite.',
    };
  }
  if (risk === 'moyen') {
    return {
      approvalLevel: 'dsi',
      requiresApproval: true,
      reason: 'Risque moyen: approbation DSI requise avant execution.',
    };
  }
  if (severity === 'P1') {
    return {
      approvalLevel: 'dsi',
      requiresApproval: true,
      reason: 'Incident P1: meme a risque faible, aucune remediation automatique sans validation humaine.',
    };
  }
  if (confidence < 70) {
    return {
      approvalLevel: 'dsi',
      requiresApproval: true,
      reason: `Confiance du diagnostic insuffisante (${confidence}% < 70%): validation humaine requise.`,
    };
  }
  return {
    approvalLevel: 'auto',
    requiresApproval: false,
    reason: `Risque faible, severite ${severity}, confiance ${confidence}%: execution automatique autorisee par la politique.`,
  };
}
