#!/usr/bin/env node
import { configManager } from '../config/config.js';

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  // Load config first
  await configManager.load();

  switch (command) {
    case 'gateway':
      await import('./gateway.js').then(m => m.runGateway());
      break;
    case 'agent':
      await import('./agent.js').then(m => m.runAgent());
      break;
    case 'message':
      await import('./message.js').then(m => m.runMessage());
      break;
    case 'onboard':
      await import('./onboard.js').then(m => m.runOnboard());
      break;
    case 'config':
      await import('./config.js').then(m => m.runConfig());
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
Copy-Clawd Bot - Personal AI Assistant

Usage: copy-clawd <command>

Commands:
  gateway      Start the gateway server
  agent        Talk to the AI agent
  message      Send a message via platform
  onboard      Set up the bot for the first time
  config       Manage configuration
  help         Show this help message

Examples:
  copy-clawd gateway
  copy-clawd agent --message "Hello"
  copy-clawd message send --to user123 --message "Hi"

For more information, visit: https://github.com/your-repo/copy-clawd-bot
`);
}

main().catch(console.error);
