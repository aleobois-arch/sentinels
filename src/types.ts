// SentinelOps Society — Shared TypeScript Interfaces

export interface Alert {
  id: string;
  service: string;
  message: string;
  timestamp: string;
  severity: 'P1' | 'P2' | 'P3' | 'P4';
}

export interface AgentMessage {
  agent: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface IncidentContext {
  alert: Alert;
  classification: string;
  investigation: string;
  rootCause: string;
  confidence: number;
  remediationPlan: string;
  remediationRisk: 'faible' | 'moyen' | 'critique';
  requiresApproval: boolean;
  approved: boolean;
  postIncidentReport: string;
  timeline: AgentMessage[];
}

export interface OrchestratorResult {
  incidentId: string;
  context: IncidentContext;
  status: 'resolved' | 'pending_approval' | 'failed';
  durationMs: number;
}
