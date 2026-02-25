import { configManager } from '../config/config.js';
import { Bot } from '../core/bot.js';

export async function runAgent() {
  const args = process.argv.slice(3); // Skip 'node' and 'agent.ts'
  const options = parseOptions(args);

  if (!options.message) {
    console.error('Error: --message is required');
    console.log('Usage: copy-clawd agent --message "Your message here"');
    process.exit(1);
  }

  console.log('Loading configuration...');
  const config = configManager.get();

  console.log('Creating bot instance...');
  const bot = new Bot({
    agent: config.agent,
    platforms: config.platforms || [],
    systemPrompt: 'You are Copy-Clawd, a helpful AI assistant.',
  });

  console.log(`\nUser: ${options.message}\n`);

  try {
    const response = await bot.chat(options.message);
    console.log(`Copy-Clawd: ${response}`);
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

interface AgentOptions {
  message?: string;
  model?: string;
  thinking?: string;
}

function parseOptions(args: string[]): AgentOptions {
  const options: AgentOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--message' && args[i + 1]) {
      options.message = args[i + 1];
      i++;
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[i + 1];
      i++;
    } else if (arg === '--thinking' && args[i + 1]) {
      options.thinking = args[i + 1];
      i++;
    } else if (!arg.startsWith('-')) {
      // Treat positional argument as message
      options.message = arg;
    }
  }

  return options;
}
