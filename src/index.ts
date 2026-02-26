#!/usr/bin/env node
import { configManager } from './config/config.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  await configManager.load();

  switch (command) {
    case 'start':
      await import('./commands/start.js').then(m => m.runStart());
      break;
    case 'gateway':
      await import('./commands/gateway.js').then(m => m.runGateway());
      break;
    case 'webhook':
      await import('./commands/webhook.js').then(m => m.runWebhook());
      break;
    case 'agent':
      await import('./commands/agent.js').then(m => m.runAgent());
      break;
    case 'message':
      await import('./commands/message.js').then(m => m.runMessage());
      break;
    case 'onboard':
      await import('./commands/onboard.js').then(m => m.runOnboard());
      break;
    case 'config':
      await import('./commands/config.js').then(m => m.runConfig());
      break;
    case 'pairing':
      await import('./commands/pairing.js').then(m => m.runPairing());
      break;
    case 'help':
    case '--help':
    case '-h':
    default:
      showHelp();
  }
}

function showHelp() {
  console.log(`
Copy-Clawd Bot - Local AI Assistant with Telegram

Usage: copy-clawd <command>

Commands:
  start        Start the bot (recommended - uses Long Polling)
  gateway      Start WebSocket gateway server
  webhook      Start webhook HTTP server
  agent        Chat directly with AI in terminal
  message      Send a message via platform
  onboard      Interactive setup wizard
  config       Manage configuration
  pairing      Manage user pairing/authorization
  help         Show this help

Quick Start:
  1. Set environment variables:
     export TELEGRAM_BOT_TOKEN=your_bot_token
     export ANTHROPIC_API_KEY=your_api_key

  2. Start the bot:
     copy-clawd start --enable-tools

  Or run the setup wizard:
     copy-clawd onboard

Start Options:
  --enable-tools    Enable AI-driven local machine tools
  --no-tools        Disable tools
  --mode polling    Use Long Polling (default, no public URL needed)
  --mode webhook    Use webhook mode (requires public URL)

Bot Commands (in Telegram):
  /reset    Clear conversation history
  /status   Show bot status
  /tools    List available tools
  pair      Request access

Environment Variables:
  ANTHROPIC_API_KEY      Anthropic Claude API key
  OPENAI_API_KEY         OpenAI API key
  TELEGRAM_BOT_TOKEN     Telegram Bot Token
  BOT_OWNER_ID           Owner's Telegram user ID
`);
}

main().catch(console.error);
