import { AgentMessage, IncidentContext, TokenUsage } from '../types';
import { callQwen, extractJson, accumulateUsage } from '../qwenClient';

const SYSTEM_PROMPT = `Tu es L'Analyste, expert en analyse de cause racine (RCA) de SentinelOps Society.
Sur la base de l'investigation outillee fournie (logs, metriques, deploiements), tu dois:
1. Identifier la cause racine probable avec precision
2. Attribuer un score de confiance de 0 a 100, calibre honnetement:
   - >85 seulement si plusieurs sources d'evidence convergent (ex: correlation deploiement + logs + metriques)
   - <60 si l'evidence est circonstancielle
3. Lister les causes secondaires possibles
4. Proposer des hypotheses alternatives et expliquer pourquoi tu les ecartes
Reponds UNIQUEMENT en JSON avec les champs:
{ "rootCause": string, "confidence": number, "secondaryCauses": [string],
  "alternatives": [string], "summary": string }`;

export interface AnalysteResult {
  rootCause: string;
  confidence: number;
  alternatives: string[];
}

export async function runAnalyste(
  context: IncidentContext,
  timeline: AgentMessage[],
  usage: TokenUsage
): Promise<AnalysteResult> {
  console.log('[Orchestrator] Running L\'Analyste...');

  const toolSummary = context.toolInvocations
    .map((inv) => `- ${inv.tool}(${JSON.stringify(inv.args)}) => ${inv.result.slice(0, 400)}`)
    .join('\n');

  const userPrompt = `INVESTIGATION:\n${context.investigation}\n\nDONNEES BRUTES DES OUTILS:\n${toolSummary}\n\nALERTE: ${context.alert.message}\nSERVICE: ${context.alert.service}`;

  timeline.push({
    agent: 'L\'Analyste',
    role: 'user',
    content: `Analyse de cause racine sur la base de ${context.toolInvocations.length} appels d'outils d'observabilite...`,
    timestamp: new Date().toISOString(),
  });

  const response = await callQwen('analyste', SYSTEM_PROMPT, userPrompt);
  accumulateUsage(usage, response.usage);

  const parsed = extractJson<{
    rootCause?: string;
    confidence?: number;
    alternatives?: string[];
  }>(response.content, {});

  const rootCause = parsed.rootCause || response.content.slice(0, 200) || 'Cause racine indeterminee';
  const confidence =
    typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 100
      ? Math.round(parsed.confidence)
      : 50;
  const alternatives = Array.isArray(parsed.alternatives) ? parsed.alternatives.map(String) : [];

  timeline.push({
    agent: 'L\'Analyste',
    role: 'assistant',
    content: `Cause racine: ${rootCause} (Confiance: ${confidence}%)`,
    timestamp: new Date().toISOString(),
  });

  return { rootCause, confidence, alternatives };
}
