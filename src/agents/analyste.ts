import { AgentMessage, IncidentContext } from '../types';
import { callQwen } from '../qwenClient';

const SYSTEM_PROMPT = `Tu es L'Analyste, expert en analyse de cause racine (RCA) de SentinelOps Society.
Sur la base de l'investigation fournie, tu dois:
1. Identifier la cause racine probable avec precision
2. Attribuer un score de confiance de 0 a 100
3. Lister les causes secondaires possibles
4. Proposer des hypotheses alternatives
Reponds en JSON avec les champs:
- rootCause: string (cause racine principale)
- confidence: number (0-100)
- secondaryCauses: string[]
- alternatives: string[]
- summary: string (resume en une phrase pour le DSI)`;

export async function runAnalyste(
  context: IncidentContext,
  timeline: AgentMessage[]
): Promise<{ rootCause: string; confidence: number }> {
  console.log('[Orchestrator] Running L\'Analyste...');

  const userPrompt = `Investigation: ${context.investigation}\nAlerte: ${context.alert.message}\nService: ${context.alert.service}`;

  timeline.push({
    agent: 'L\'Analyste',
    role: 'user',
    content: 'Analyse de cause racine en cours...',
    timestamp: new Date().toISOString(),
  });

  const result = await callQwen(SYSTEM_PROMPT, userPrompt);

  let rootCause = 'Cause racine indeterminee';
  let confidence = 50;

  try {
    const cleaned = result.replace(/```json\n?|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    rootCause = parsed.rootCause || rootCause;
    confidence = typeof parsed.confidence === 'number' ? parsed.confidence : confidence;
  } catch {
    rootCause = result.substring(0, 200);
  }

  timeline.push({
    agent: 'L\'Analyste',
    role: 'assistant',
    content: `Cause racine: ${rootCause} (Confiance: ${confidence}%)`,
    timestamp: new Date().toISOString(),
  });

  return { rootCause, confidence };
}
