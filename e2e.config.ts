import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Local Ollama endpoint (no API key required; "ollama" is a placeholder).
const localLlm = createOpenAICompatible({
  name: 'local-ollama',
  baseURL: 'http://127.0.0.1:11434/v1',
  apiKey: 'ollama',
});

export default {
  targets: [
    {
      name: 'web',
      engine: web(),
      app: {
        url: 'http://127.0.0.1:3111',
        readyUrl: 'http://127.0.0.1:3111/health/live',
        command: {
          executable: process.execPath,
          args: ['scripts/e2e-app.mjs'],
          log: '.e2e/logs/app.log',
          startupTimeout: 120_000,
        },
      },
    },
  ],
  tests: ['tests/**/*.e2e.ts'],
  credentials: {
    admin: { username: 'admin@example.com', password: 'Admin12345!' },
    manager: { username: 'manager@example.com', password: 'Manager12345!' },
    user: { username: 'user@example.com', password: 'User12345!' },
    viewer: { username: 'viewer@example.com', password: 'Viewer12345!' },
  },
  agents: {
    default: {
      model: localLlm.chatModel('qwen38-code:latest'),
      system:
        'You are an exploratory QA agent for an internal ticketing web app. ' +
        'Interact only through visible form controls and links. Never invent URLs.',
    },
  },
  retries: 0,
  workers: 1,
  timeout: 120_000,
  reporters: ['list', 'junit', 'markdown'],
} satisfies E2EConfig;