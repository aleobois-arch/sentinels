import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.QWEN_API_KEY || '',
  baseURL: process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

export async function callQwen(systemPrompt: string, userPrompt: string): Promise<string> {
  console.log('[QwenClient] Calling Qwen model...');
  try {
    const response = await client.chat.completions.create({
      model: 'qwen-plus',
      max_tokens: 2048,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const result = response.choices[0]?.message?.content || '';
    console.log('[QwenClient] Response received.');
    return result;
  } catch (error: any) {
    console.error('[QwenClient] Error calling Qwen API:', error.message);
    throw new Error(`Qwen API call failed: ${error.message}`);
  }
}
