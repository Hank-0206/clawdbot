#!/usr/bin/env node
import { configManager } from '../config/config.js';
import { Bot } from '../core/bot.js';
import { createPlatformAdapter } from '../platforms/index.js';

interface StartOptions {
  port?: number;
  enableTools?: boolean;
  mode?: 'polling' | 'webhook';
}

/**
 * Start command - launches the bot locally with Telegram Long Polling
 * No public URL needed. Just a Telegram Bot Token and an AI API key.
 */
export async function runStart() {
  const args = process.argv.slice(2);
  const options = parseOptions(args);

  // Global error handlers
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
  });

  console.log(`
+----------------------------------------------------------+
|              Copy-Clawd Bot - Starting...                |
+----------------------------------------------------------+
`);

  // Load configuration
  await configManager.load();
  const config = configManager.get();

  // Allow env vars to override config
  if (process.env.TELEGRAM_BOT_TOKEN && !config.platforms?.find(p => p.type === 'telegram')) {
    // Auto-configure Telegram from env
    config.platforms = config.platforms || [];
    config.platforms.push({
      type: 'telegram',
      enabled: true,
      config: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        mode: 'polling',
      },
    });
  }

  if (process.env.ANTHROPIC_API_KEY && !config.agent.apiKey) {
    config.agent.apiKey = process.env.ANTHROPIC_API_KEY;
  }

  // Set owner ID: env var > config file > default
  config.ownerId = process.env.BOT_OWNER_ID || config.ownerId || '7827553050';

  const enableTools = options.enableTools ?? config.enableTools ?? true;

  console.log('Configuration:');
  console.log(`  AI Provider: ${config.agent.provider || 'anthropic'}`);
  console.log(`  Model: ${config.agent.model}`);
  console.log(`  Tools: ${enableTools ? 'enabled' : 'disabled'}`);
  console.log(`  Owner ID: ${config.ownerId || 'not set (first user auto-approved)'}`);

  // Find Telegram platform config
  const telegramConfig = config.platforms?.find(p => p.type === 'telegram');

  if (!telegramConfig?.enabled) {
    console.log(`
Telegram is not configured. You can configure it by:

  1. Setting environment variable:
     export TELEGRAM_BOT_TOKEN=your_bot_token

  2. Or running the onboard wizard:
     npx tsx src/commands/onboard.ts

  3. Or editing ~/.copy-clawd/config.yaml
`);
    process.exit(1);
  }

  // Create bot instance
  const bot = new Bot({
    agent: config.agent,
    platforms: config.platforms || [],
    systemPrompt: config.systemPrompt,
    ownerId: config.ownerId,
    enableTools,
  });

  // Initialize and start Telegram adapter
  const adapter = createPlatformAdapter('telegram');

  try {
    const adapterConfig = {
      ...telegramConfig.config,
      mode: options.mode || telegramConfig.config.mode || 'polling',
    };

    await adapter.initialize(adapterConfig);

    // Register adapter with bot so handleMessage can use it to send replies
    bot.registerAdapter(adapter);

    adapter.onMessage(async (message) => {
      console.log(`[${message.platform}] ${message.metadata?.senderName || message.sender}: ${message.content.slice(0, 60)}`);

      try {
        await bot.handleMessage(message);
      } catch (error: any) {
        console.error(`[${message.platform}] Error:`, error.message);
        try {
          await adapter.sendMessage(
            message.conversationId || message.sender,
            `Error processing message: ${error.message}`
          );
        } catch { /* ignore send error */ }
      }
    });

    await adapter.start();
  } catch (error: any) {
    console.error('Failed to start Telegram:', error.message);
    process.exit(1);
  }

  console.log(`
Started successfully!

  Telegram Bot is running (Long Polling mode)
  - No public URL needed
  - Messages are fetched directly from Telegram

  AI: ${config.agent.provider || 'anthropic'} / ${config.agent.model}
  ${config.ownerId ? `Owner: ${config.ownerId}` : 'Owner: not set'}

  Bot commands:
    /reset    - Clear conversation history
    /status   - Show bot status
    /tools    - List available tools
    pair      - Request pairing access

  ${enableTools ? `Tools enabled - AI can execute commands on this machine.
  The AI can: run shell commands, read/write files, manage processes,
  check system info, open URLs, and more.` : 'Tools disabled.'}

  Press Ctrl+C to stop
`);

  // Keep process running
  return new Promise(() => {
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await adapter.stop();
      await bot.stop();
      process.exit(0);
    });
  });
}

function parseOptions(args: string[]): StartOptions {
  const options: StartOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      options.port = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--enable-tools') {
      options.enableTools = true;
    } else if (arg === '--no-tools') {
      options.enableTools = false;
    } else if (arg === '--mode' && args[i + 1]) {
      options.mode = args[i + 1] as 'polling' | 'webhook';
      i++;
    }
  }

  return options;
}
