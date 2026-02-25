import { configManager } from '../config/config.js';
import { Bot } from '../core/bot.js';

export async function runMessage() {
  const args = process.argv.slice(3); // Skip 'node' and 'message.ts'
  const options = parseOptions(args);

  if (!options.to || !options.message) {
    console.error('Error: --to and --message are required');
    console.log('Usage: copy-clawd message send --to <user> --message <message> [--platform <platform>]');
    process.exit(1);
  }

  const config = configManager.get();
  const platform = options.platform || 'dingtalk';

  const bot = new Bot({
    agent: config.agent,
    platforms: config.platforms || [],
  });

  try {
    await bot.sendMessage(platform, options.to, options.message);
    console.log(`Message sent to ${options.to} via ${platform}`);
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

interface MessageOptions {
  to?: string;
  message?: string;
  platform?: string;
}

function parseOptions(args: string[]): MessageOptions {
  const options: MessageOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--to' && args[i + 1]) {
      options.to = args[i + 1];
      i++;
    } else if (arg === '--message' && args[i + 1]) {
      options.message = args[i + 1];
      i++;
    } else if (arg === '--platform' && args[i + 1]) {
      options.platform = args[i + 1];
      i++;
    }
  }

  return options;
}
