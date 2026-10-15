// Probes the local LLM endpoint for OpenAI-compatible chat + tool-call support.
// Usage: node scripts/probe-llm.mjs [baseUrl] [model]
const baseUrl = process.argv[2] || 'http://127.0.0.1:11434/v1';
const model = process.argv[3] || 'qwen38-code:latest';

async function main() {
  const modelsRes = await fetch(`${baseUrl}/models`);
  console.log('GET /models ->', modelsRes.status);
  if (!modelsRes.ok) {
    console.log((await modelsRes.text()).slice(0, 500));
    process.exit(1);
  }
  const models = await modelsRes.json();
  console.log('models:', JSON.stringify(models.data?.map((m) => m.id) ?? models));

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'user', content: 'Use the get_weather tool to get the weather in Paris.' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather for a city',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        },
      ],
      tool_choice: 'auto',
      max_tokens: 300,
    }),
  });
  console.log('POST /chat/completions ->', res.status);
  const text = await res.text();
  console.log(text.slice(0, 4000));
}

main().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});