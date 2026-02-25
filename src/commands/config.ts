import { configManager } from '../config/config.js';
import { PlatformType } from '../types/index.js';

export async function runConfig() {
  const args = process.argv.slice(3);
  const subcommand = args[0];

  switch (subcommand) {
    case 'show':
      showConfig();
      break;
    case 'get':
      getConfigValue(args[1]);
      break;
    case 'set':
      setConfigValue(args[1], args[2]);
      break;
    case 'add-platform':
      addPlatform(args[1], args.slice(2));
      break;
    default:
      showConfig();
  }
}

function showConfig() {
  const config = configManager.get();

  console.log('Current Configuration:');
  console.log('---------------------');
  console.log(`AI Provider: ${config.agent.provider}`);
  console.log(`Model: ${config.agent.model}`);
  console.log(`API Key: ${config.agent.apiKey ? '***' : 'not set'}`);
  console.log(`Base URL: ${config.agent.baseUrl || 'default'}`);
  console.log(`Workspace: ${config.workspace}`);

  if (config.platforms && config.platforms.length > 0) {
    console.log('\nPlatforms:');
    config.platforms.forEach((platform, index) => {
      console.log(`  ${index + 1}. ${platform.type} (${platform.enabled ? 'enabled' : 'disabled'})`);
    });
  }
}

function getConfigValue(key: string) {
  const config = configManager.get();

  switch (key) {
    case 'provider':
      console.log(config.agent.provider);
      break;
    case 'model':
      console.log(config.agent.model);
      break;
    case 'apiKey':
      console.log(config.agent.apiKey || '');
      break;
    default:
      console.log(`Unknown key: ${key}`);
  }
}

function setConfigValue(key: string, value: string) {
  const config = configManager.get();

  switch (key) {
    case 'provider':
      config.agent.provider = value as any;
      break;
    case 'model':
      config.agent.model = value;
      break;
    case 'apiKey':
      config.agent.apiKey = value;
      break;
    case 'baseUrl':
      config.agent.baseUrl = value;
      break;
    default:
      console.log(`Unknown key: ${key}`);
      return;
  }

  configManager.update(config);
  configManager.save();
  console.log(`Set ${key} = ${value}`);
}

function addPlatform(type: string, args: string[]) {
  if (!type) {
    console.log('Usage: copy-clawd config add-platform <type> [options]');
    console.log('  telegram --token <botToken> --mode polling|webhook');
    console.log('\nExample: copy-clawd config add-platform telegram --token XXX --mode polling');
    return;
  }

  const config = configManager.get();
  const platforms = config.platforms || [];

  // Parse args
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      options[args[i].slice(2)] = args[i + 1] || '';
      i++;
    }
  }

  const platformConfig = {
    type: type as PlatformType,
    enabled: true,
    config: {} as Record<string, any>,
  };

  switch (type) {
    case 'telegram':
      platformConfig.config.botToken = options.token || process.env.TELEGRAM_BOT_TOKEN || '';
      platformConfig.config.mode = options.mode || 'polling';
      if (!platformConfig.config.botToken) {
        console.log('Error: Telegram bot token required');
        console.log('Usage: copy-clawd config add-platform telegram --token <botToken>');
        return;
      }
      break;
    case 'dingtalk':
      platformConfig.config.webhook = options.webhook || '';
      platformConfig.config.secret = options.secret || '';
      break;
    default:
      console.log(`Platform ${type} not supported for quick add`);
      console.log('Use onboard wizard: copy-clawd onboard');
      return;
  }

  // Remove existing platform of same type
  const existingIndex = platforms.findIndex(p => p.type === type);
  if (existingIndex >= 0) {
    platforms[existingIndex] = platformConfig;
  } else {
    platforms.push(platformConfig);
  }

  config.platforms = platforms;
  configManager.update(config);
  configManager.save();

  console.log(`Added/Updated platform: ${type}`);
  console.log(`  Token: ${platformConfig.config.botToken ? '***' : 'not set'}`);
  console.log(`  Mode: ${platformConfig.config.mode}`);
}
