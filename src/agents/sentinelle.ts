import { Alert, AgentMessage, RawAlertInput, Severity, TokenUsage } from '../types';
import { callQwen, extractJson, accumulateUsage } from '../qwenClient';

const SYSTEM_PROMPT = `Tu es Le Sentinelle, agent de surveillance operationnelle de SentinelOps Society.
Tu recois une alerte de production qui peut etre STRUCTUREE (JSON propre) ou AMBIGUE
(email de monitoring, message Slack d'un developpeur paniqu e, payload webhook brut, texte libre).
Ta mission:
1. Extraire ou normaliser: le service impacte, un message d'alerte technique concis
2. Confirmer ou attribuer la severite ANSSI (P1 critique / P2 majeur / P3 modere / P4 mineur)
3. Estimer le perimetre d'impact (utilisateurs, revenus, SLA)
4. Rediger une classification structuree en francais
Si l'entree est vague, fais les hypotheses les plus prudentes (severite superieure) et signale-le.
Reponds UNIQUEMENT en JSON avec les champs:
{ "severity": "P1|P2|P3|P4", "service": string, "impact": string, "classification": string,
  "perimetre": string, "normalizedMessage": string }`;

export interface SentinelleResult {
  classification: string;
  normalizedAlert: Alert;
}

/**
 * Classifies a structured alert OR normalizes a raw, ambiguous one
 * (email / Slack / webhook text) into a structured Alert.
 */
export async function runSentinelle(
  input: Alert | RawAlertInput,
  timeline: AgentMessage[],
  usage: TokenUsage
): Promise<SentinelleResult> {
  console.log('[Orchestrator] Running Le Sentinelle...');

  const isRaw = 'rawText' in input;
  timeline.push({
    agent: 'Le Sentinelle',
    role: 'user',
    content: isRaw
      ? `Normalisation d'une alerte non structuree (source: ${input.source || 'inconnue'}): "${input.rawText.slice(0, 160)}${input.rawText.length > 160 ? '...' : ''}"`
      : `Analyse de l'alerte: ${input.message} (Severite declaree: ${input.severity})`,
    timestamp: new Date().toISOString(),
  });

  const userPrompt = isRaw
    ? `ALERTE BRUTE (source: ${input.source || 'inconnue'}):\n${input.rawText}`
    : JSON.stringify(input);

  const response = await callQwen('sentinelle', SYSTEM_PROMPT, userPrompt);
  accumulateUsage(usage, response.usage);

  const parsed = extractJson<{
    severity?: string;
    service?: string;
    impact?: string;
    classification?: string;
    perimetre?: string;
    normalizedMessage?: string;
  }>(response.content, {});

  const validSeverities: Severity[] = ['P1', 'P2', 'P3', 'P4'];
  const severity: Severity = validSeverities.includes(parsed.severity as Severity)
    ? (parsed.severity as Severity)
    : isRaw
      ? 'P2'
      : input.severity;

  const normalizedAlert: Alert = isRaw
    ? {
        id: `ALT-${Date.now()}`,
        service: parsed.service || 'service-inconnu',
        message: parsed.normalizedMessage || input.rawText.slice(0, 200),
        timestamp: new Date().toISOString(),
        severity,
        source: input.source || 'raw_text',
      }
    : { ...input, severity, service: parsed.service || input.service };

  timeline.push({
    agent: 'Le Sentinelle',
    role: 'assistant',
    content: response.content,
    timestamp: new Date().toISOString(),
  });

  return { classification: response.content, normalizedAlert };
}
