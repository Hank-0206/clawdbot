import { configManager } from '../config/config.js';

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
  console.log(`Adding platform: ${type}`);
  console.log('Use onboard wizard to add platforms with full configuration');
}
