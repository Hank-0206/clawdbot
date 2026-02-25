import http from 'http';
import { configManager } from '../config/config.js';
import { Bot } from '../core/bot.js';
import { createPlatformAdapter } from '../platforms/index.js';
import { PlatformAdapter } from '../types/index.js';

const DEFAULT_PORT = 3000;

interface WebhookServerOptions {
  port?: number;
}

export async function runWebhook() {
  const args = process.argv.slice(3);
  const options = parseOptions(args);

  console.log('Starting Copy-Clawd Webhook Server...');
  console.log(`Port: ${options.port || DEFAULT_PORT}`);

  // Load configuration
  const config = configManager.get();
  console.log('Loaded configuration:');
  console.log(`  AI Provider: ${config.agent.provider}`);
  console.log(`  Model: ${config.agent.model}`);
  console.log(`  Enable Tools: ${config.enableTools ? 'Yes' : 'No'}`);
  console.log(`  Owner ID: ${config.ownerId || 'Not set'}`);

  // Create bot instance
  const bot = new Bot({
    agent: config.agent,
    platforms: config.platforms || [],
    systemPrompt: config.systemPrompt || 'You are Copy-Clawd, a helpful AI assistant.',
    ownerId: config.ownerId,
    enableTools: config.enableTools ?? true,
  });

  // Initialize platform adapters
  const platformAdapters: Map<string, PlatformAdapter> = new Map();

  for (const platformConfig of config.platforms || []) {
    if (platformConfig.enabled) {
      const adapter = createPlatformAdapter(platformConfig.type);
      try {
        await adapter.initialize(platformConfig.config);
        adapter.onMessage(async (message) => {
          console.log(`[${message.platform}] Received: ${message.content}`);

          // Handle message through bot logic (will check pairing and tools)
          await bot['handleMessage'](message);
        });
        platformAdapters.set(platformConfig.type, adapter);
        console.log(`[${platformConfig.type}] Adapter initialized`);
      } catch (error) {
        console.error(`[${platformConfig.type}] Failed to initialize:`, error);
      }
    }
  }

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Bot-Api-Secret-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check endpoint
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        platforms: Array.from(platformAdapters.keys()),
        uptime: process.uptime(),
      }));
      return;
    }

    // Parse URL to get platform from path
    const url = new URL(req.url || '/', `http://localhost:${options.port || DEFAULT_PORT}`);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const platform = pathParts[0] || 'telegram';

    // Get adapter for this platform
    const adapter = platformAdapters.get(platform);

    if (!adapter) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Platform ${platform} not configured` }));
      return;
    }

    // Read request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      data = {};
    }

    // Process webhook based on platform
    let message = null;

    if (platform === 'telegram') {
      // Telegram webhook
      if (adapter && 'processWebhook' in adapter) {
        message = (adapter as any).processWebhook(data);
      }
    } else if (platform === 'discord') {
      // Discord interactions
      if (adapter && 'processInteraction' in adapter) {
        message = (adapter as any).processInteraction(data);
      }
      if (adapter && 'processWebhook' in adapter) {
        message = (adapter as any).processWebhook(data);
      }
    } else if (platform === 'dingtalk') {
      // DingTalk webhook
      if (adapter && 'processWebhook' in adapter) {
        message = (adapter as any).processWebhook(data);
      }
    } else if (platform === 'feishu') {
      // Feishu webhook
      if (adapter && 'processWebhook' in adapter) {
        message = (adapter as any).processWebhook(data);
      }
    }

    // Handle the message
    if (message) {
      console.log(`[${platform}] Processing message from ${message.sender}`);

      // Check if user is approved
      const { pairingManager } = await import('../core/pairing.js');

      if (!pairingManager.isApproved(platform, message.sender)) {
        // Generate pairing code
        const code = pairingManager.createPairingCode(platform, message.sender);

        // Send pairing message
        if (adapter) {
          await adapter.sendMessage(message.sender,
            `Access not configured.\n\nYour ${platform} user id: ${message.sender}\n\nPairing code: ${code}\n\nAsk the bot owner to approve with:\ncopy-clawd pairing approve ${code}`
          );
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Pairing required' }));
        return;
      }

      // Handle tool commands
      if (config.enableTools && message.sender === config.ownerId && message.content.startsWith('!')) {
        const { toolManager } = await import('../core/tools.js');
        const parts = message.content.slice(1).split(' ');
        const toolName = parts[0];
        const args = { command: parts.slice(1).join(' ') };

        const result = await toolManager.execute(toolName, args);

        if (adapter) {
          const response = result.success
            ? `✓ Success\n\n${result.output}`
            : `✗ Error: ${result.error}`;
          await adapter.sendMessage(message.sender, response);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // Regular AI chat
      try {
        const response = await bot.chat(message.content);
        if (adapter) {
          await adapter.sendMessage(message.sender, response);
        }
      } catch (error: any) {
        console.error(`[${platform}] Error:`, error);
        if (adapter) {
          await adapter.sendMessage(message.sender, `Error: ${error.message}`);
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  server.listen(options.port || DEFAULT_PORT, () => {
    console.log(`\nWebhook server listening on http://localhost:${options.port || DEFAULT_PORT}`);
    console.log('\nConfigure your platform webhooks:');

    for (const [platform, adapter] of platformAdapters) {
      console.log(`  ${platform}: http://localhost:${options.port || DEFAULT_PORT}/${platform}`);
    }

    console.log('\nNext steps:');
    console.log('1. Set up your platform webhooks to point to the URLs above');
    console.log('2. For Telegram: curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=..."');
    console.log('\nPress Ctrl+C to stop\n');
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    server.close();
    for (const [, adapter] of platformAdapters) {
      await adapter.stop();
    }
    process.exit(0);
  });
}

function parseOptions(args: string[]): WebhookServerOptions {
  const options: WebhookServerOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      options.port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return options;
}
