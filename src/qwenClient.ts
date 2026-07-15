import OpenAI from 'openai';
import 'dotenv/config';
import { TokenUsage } from './types';
import { getMock } from './mocks';

const MODEL = process.env.QWEN_MODEL || 'qwen-plus';
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 90_000;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.QWEN_API_KEY || '',
      // Qwen on Alibaba Cloud, OpenAI-compatible mode (DashScope international endpoint)
      baseURL: process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      timeout: REQUEST_TIMEOUT_MS,
    });
  }
  return client;
}

export function isMockMode(): boolean {
  return process.env.MOCK_QWEN === '1';
}

export interface QwenResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number };
}

function isRetryable(error: any): boolean {
  const status = error?.status ?? error?.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  // Network-level failures (no HTTP status)
  return status === undefined;
}

async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        const delayMs = 500 * Math.pow(2, attempt);
        console.warn(`[QwenClient] ${label} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error.message}. Retrying in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        break;
      }
    }
  }
  throw new Error(`Qwen API call failed after retries: ${lastError?.message}`);
}

export function accumulateUsage(total: TokenUsage, delta: { promptTokens: number; completionTokens: number }): void {
  total.promptTokens += delta.promptTokens;
  total.completionTokens += delta.completionTokens;
  total.calls += 1;
}

/** Simple single-turn completion. */
export async function callQwen(
  agentKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<QwenResponse> {
  if (isMockMode()) {
    return { content: getMock(agentKey), usage: { promptTokens: 0, completionTokens: 0 } };
  }

  return withRetries(`callQwen(${agentKey})`, async () => {
    const response = await getClient().chat.completions.create({
      model: MODEL,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return {
      content: response.choices[0]?.message?.content || '',
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  });
}

export interface AgenticToolLoopResult {
  content: string;
  usage: { promptTokens: number; completionTokens: number };
  toolCallCount: number;
}

/**
 * Agentic loop using Qwen native function calling (OpenAI-compatible `tools` API).
 * The model decides which observability tools to call; we execute them and feed
 * the results back until the model produces its final answer.
 */
export async function callQwenWithTools(
  agentKey: string,
  systemPrompt: string,
  userPrompt: string,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  options: { maxRounds?: number; temperature?: number } = {}
): Promise<AgenticToolLoopResult> {
  const maxRounds = options.maxRounds ?? 6;
  const usage = { promptTokens: 0, completionTokens: 0 };
  let toolCallCount = 0;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  for (let round = 0; round < maxRounds; round++) {
    const response = await withRetries(`callQwenWithTools(${agentKey}, round ${round + 1})`, () =>
      getClient().chat.completions.create({
        model: MODEL,
        max_tokens: 2048,
        temperature: options.temperature ?? 0.2,
        messages,
        tools,
      })
    );

    usage.promptTokens += response.usage?.prompt_tokens ?? 0;
    usage.completionTokens += response.usage?.completion_tokens ?? 0;

    const message = response.choices[0]?.message;
    if (!message) break;

    const toolCalls = message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return { content: message.content || '', usage, toolCallCount };
    }

    messages.push(message);
    for (const toolCall of toolCalls) {
      toolCallCount++;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        // Malformed arguments from the model — pass empty args, the tool will report it.
      }
      const result = await executeTool(toolCall.function.name, args);
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
    }
  }

  // Round budget exhausted: force a final answer without tools.
  messages.push({
    role: 'user',
    content: 'Budget d\'appels outils epuise. Produis maintenant ta reponse finale avec les informations collectees.',
  });
  const finalResponse = await withRetries(`callQwenWithTools(${agentKey}, final)`, () =>
    getClient().chat.completions.create({
      model: MODEL,
      max_tokens: 2048,
      temperature: options.temperature ?? 0.2,
      messages,
    })
  );
  usage.promptTokens += finalResponse.usage?.prompt_tokens ?? 0;
  usage.completionTokens += finalResponse.usage?.completion_tokens ?? 0;
  return { content: finalResponse.choices[0]?.message?.content || '', usage, toolCallCount };
}

/** Extract the first JSON object from an LLM response (handles ```json fences and prose). */
export function extractJson<T>(raw: string, fallback: T): T {
  const cleaned = raw.replace(/```json\n?|```/g, '').trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(cleaned.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try next candidate
    }
  }
  return fallback;
}
