// SentinelOps Society — Shared TypeScript Interfaces

export type Severity = 'P1' | 'P2' | 'P3' | 'P4';
export type Risk = 'faible' | 'moyen' | 'critique';
export type ApprovalLevel = 'auto' | 'dsi' | 'rssi_dsi';
export type IncidentStatus =
  | 'running'
  | 'pending_approval'
  | 'executing'
  | 'resolved'
  | 'rejected'
  | 'failed';

export interface Alert {
  id: string;
  service: string;
  message: string;
  timestamp: string;
  severity: Severity;
  /** Where the alert came from: cloudmonitor, pagerduty, email, slack, manual... */
  source?: string;
}

/** Raw, unstructured alert input (email body, Slack message, webhook payload...). */
export interface RawAlertInput {
  rawText: string;
  source?: string;
}

export interface AgentMessage {
  agent: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
}

/** One observability/remediation tool call made by an agent. */
export interface ToolInvocation {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: string;
  durationMs: number;
}

/** A concrete remediation action, constrained to the tool registry. */
export interface RemediationAction {
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  calls: number;
}

export interface IncidentContext {
  alert: Alert;
  classification: string;
  investigation: string;
  /** Observability tool calls made during the investigation. */
  toolInvocations: ToolInvocation[];
  rootCause: string;
  confidence: number;
  alternatives: string[];
  remediationPlan: string;
  /** Machine-executable actions proposed by L'Operateur. */
  actions: RemediationAction[];
  rollbackPlan: string;
  remediationRisk: Risk;
  approvalLevel: ApprovalLevel;
  approvalReason: string;
  requiresApproval: boolean;
  approved: boolean;
  /** Results of executed remediation actions. */
  executionResults: ToolInvocation[];
  postIncidentReport: string;
  timeline: AgentMessage[];
  usage: TokenUsage;
}

export interface IncidentRecord {
  incidentId: string;
  status: IncidentStatus;
  createdAt: string;
  updatedAt: string;
  context: IncidentContext;
  durationMs: number;
  approver?: string;
  decisionNote?: string;
}

export interface OrchestratorResult {
  incidentId: string;
  context: IncidentContext;
  status: IncidentStatus;
  durationMs: number;
}
