#!/usr/bin/env node
import { configManager } from './config/config.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  // Load config first
  await configManager.load();

  switch (command) {
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
╔════════════════════════════════════════════════════════════╗
║              Copy-Clawd Bot - Personal AI Assistant          ║
╚════════════════════════════════════════════════════════════╝

Usage: copy-clawd <command>

Commands:
  gateway      Start the gateway server (WebSocket)
  webhook      Start webhook server (HTTP)
  agent        Talk to the AI agent
  message      Send a message via platform
  onboard      Set up the bot for the first time
  config       Manage configuration
  pairing      Manage user pairing/approval
  help         Show this help message

Examples:
  copy-clawd onboard                 # First time setup
  copy-clawd webhook --port 3000     # Start webhook server
  copy-clawd gateway --port 18789     # Start gateway server
  copy-clawd agent --message "Hello"  # Test AI chat
  copy-clawd pairing approve JFY4PLJ6

Tool Commands (owner only):
  !<command>        Execute shell command
  !ls               List directory
  !pwd              Show current directory
  !sysinfo          Show system info

Environment Variables:
  ANTHROPIC_API_KEY      API key for Anthropic Claude
  OPENAI_API_KEY         API key for OpenAI
  TELEGRAM_BOT_TOKEN     Telegram bot token

For more information, visit: https://github.com/your-repo/copy-clawd-bot
`);
}

main().catch(console.error);
