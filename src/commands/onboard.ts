import fs from 'fs';
import path from 'path';
import { configManager } from '../config/config.js';
import { AIProviderType } from '../types/index.js';

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.copy-clawd');
const ENV_FILE = path.join(CONFIG_DIR, '.env');

const AI_MODELS = {
  anthropic: [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (最强)' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (推荐)' },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { value: 'claude-haiku-3-5', label: 'Claude Haiku 3.5 (最快)' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o (最强)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (最快)' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (最快)' },
  ],
  'azure-openai': [
    { value: 'gpt-4', label: 'GPT-4' },
    { value: 'gpt-35-turbo', label: 'GPT-3.5 Turbo' },
  ],
  openrouter: [
    { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { value: 'anthropic/claude-3-opus', label: 'Claude 3 Opus' },
    { value: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku' },
    { value: 'openai/gpt-4o', label: 'GPT-4o' },
    { value: 'openai/gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'google/gemini-pro-1.5', label: 'Gemini Pro 1.5' },
  ],
  opencode: [
    { value: 'opencode/gpt-4o', label: 'OpenCode GPT-4o' },
    { value: 'opencode/gpt-4o-mini', label: 'OpenCode GPT-4o Mini' },
  ],
  minimax: [
    { value: 'MiniMax-M2.5', label: 'MiniMax M2.5' },
  ],
};

export async function runOnboard() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           欢迎使用 Copy-Clawd Bot 配置向导!              ║
║              个人 AI 助手配置                            ║
╚════════════════════════════════════════════════════════════╝
`);

  const args = process.argv.slice(3);

  if (args.includes('--install-daemon')) {
    await installDaemon();
    return;
  }

  // Check if config already exists
  const existingConfig = configManager.get();
  const isUpgrade = existingConfig.agent?.model;

  if (isUpgrade) {
    console.log('发现已有配置，这将更新你的设置。\n');
  }

  // ========== Step 1: AI Provider ==========
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  Step 1: AI Provider Configuration                     │');
  console.log('└─────────────────────────────────────────────────────────┘');

  let provider: string;
  if (existingConfig.agent?.provider) {
    const existing = existingConfig.agent.provider;
    const useExisting = await promptConfirm(`Use existing provider: ${existing}?`);
    if (useExisting) {
      provider = existing;
    } else {
      provider = await promptChoice('Select AI provider:', [
        { value: 'anthropic', label: 'Anthropic Claude' },
        { value: 'openai', label: 'OpenAI' },
        { value: 'azure-openai', label: 'Azure OpenAI' },
      ]);
    }
  } else {
    provider = await promptChoice('Select AI provider:', [
      { value: 'anthropic', label: 'Anthropic Claude (Recommended)' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'azure-openai', label: 'Azure OpenAI' },
    ]);
  }

  // Step 2: Model selection
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  Step 2: Model Selection                               │');
  console.log('└─────────────────────────────────────────────────────────┘');

  let model: string;
  const models = AI_MODELS[provider as keyof typeof AI_MODELS] || AI_MODELS.anthropic;

  if (existingConfig.agent?.model && provider === existingConfig.agent.provider) {
    const useExisting = await promptConfirm(`Use existing model: ${existingConfig.agent.model}?`);
    if (useExisting) {
      model = existingConfig.agent.model;
    } else {
      model = await promptChoice('Select model:', models);
    }
  } else {
    model = await promptChoice('Select model:', models);
  }

  // Step 3: API Key
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  Step 3: API Key Configuration                         │');
  console.log('└─────────────────────────────────────────────────────────┘');

  let apiKey = '';
  let baseUrl = '';

  if (provider === 'anthropic') {
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey) {
      const useEnv = await promptConfirm('Use ANTHROPIC_API_KEY from environment?');
      if (!useEnv) {
        apiKey = await promptInput('Enter Anthropic API Key:', '');
      }
    } else {
      apiKey = await promptInput('Enter Anthropic API Key:', '');
    }
  } else if (provider === 'openai') {
    const envKey = process.env.OPENAI_API_KEY;
    if (envKey) {
      const useEnv = await promptConfirm('Use OPENAI_API_KEY from environment?');
      if (!useEnv) {
        apiKey = await promptInput('Enter OpenAI API Key:', '');
      }
    } else {
      apiKey = await promptInput('Enter OpenAI API Key:', '');
    }
  } else if (provider === 'azure-openai') {
    apiKey = await promptInput('Enter Azure API Key:', '');
    baseUrl = await promptInput('Enter Azure Endpoint (e.g., https://xxx.openai.azure.com):', '');
  }

  // Step 4: Advanced AI Settings
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  Step 4: Advanced AI Settings (Optional)               │');
  console.log('└─────────────────────────────────────────────────────────┘');

  const configureAdvanced = await promptConfirm('Configure advanced AI settings?');

  let temperature = 1.0;
  let maxTokens = 4096;

  if (configureAdvanced) {
    const tempInput = await promptInput('Temperature (0.0-1.0, default: 1.0):', '1.0');
    temperature = parseFloat(tempInput) || 1.0;

    const tokensInput = await promptInput('Max tokens (default: 4096):', '4096');
    maxTokens = parseInt(tokensInput) || 4096;
  }

  // Step 5: Platform Setup
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  Step 5: Platform Configuration                        │');
  console.log('└─────────────────────────────────────────────────────────┘');

  const platforms: any[] = [];

  if (existingConfig.platforms && existingConfig.platforms.length > 0) {
    const useExisting = await promptConfirm('You have existing platforms. Keep them?');
    if (useExisting) {
      platforms.push(...existingConfig.platforms);
    }
  }

  const addPlatform = await promptConfirm('Add a chat platform?');

  if (addPlatform) {
    while (true) {
      const platformType = await promptChoice('Select platform to add:', [
        { value: 'telegram', label: 'Telegram' },
        { value: 'dingtalk', label: 'DingTalk (钉钉)' },
        { value: 'feishu', label: 'Feishu (飞书)' },
        { value: 'wechat-work', label: 'WeChat Work (企业微信)' },
        { value: 'slack', label: 'Slack' },
        { value: 'discord', label: 'Discord' },
      ]);

      const platformConfig = await configurePlatform(platformType);
      platforms.push(platformConfig);

      const more = await promptConfirm('Add another platform?');
      if (!more) break;
    }
  }

  // Step 6: Owner Configuration
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  Step 6: Owner Configuration                          │');
  console.log('└─────────────────────────────────────────────────────────┘');

  let ownerId = '';
  if (existingConfig.ownerId) {
    const useExisting = await promptConfirm(`Use existing owner ID: ${existingConfig.ownerId}?`);
    if (useExisting) {
      ownerId = existingConfig.ownerId;
    } else {
      ownerId = await promptInput('Enter your Telegram/Platform user ID (for approval management):', '');
    }
  } else {
    ownerId = await promptInput('Enter your Telegram/Platform user ID (for approval management):', '');
  }

  // Step 7: System Prompt
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  Step 7: System Prompt                                │');
  console.log('└─────────────────────────────────────────────────────────┘');

  let systemPrompt = 'You are Copy-Clawd, a helpful and friendly AI assistant.';
  const configurePrompt = await promptConfirm('Configure custom system prompt?');

  if (configurePrompt) {
    console.log('\nEnter your custom system prompt (press Enter for default):');
    const customPrompt = await promptInput('System prompt:', 'You are Copy-Clawd, a helpful and friendly AI assistant.');
    if (customPrompt) {
      systemPrompt = customPrompt;
    }
  }

  // ========== Save Configuration ==========
  console.log('\n┌─────────────────────────────────────────────────────────┐');
  console.log('│  Saving Configuration...                              │');
  console.log('└─────────────────────────────────────────────────────────┘');

  const config = {
    agent: {
      provider: provider as AIProviderType,
      model: model,
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      temperature,
      maxTokens,
    },
    platforms: platforms,
    workspace: CONFIG_DIR,
    ownerId: ownerId || undefined,
    systemPrompt,
  };

  configManager.update(config);
  await configManager.save();

  // Save environment variables
  const envVars: string[] = [];
  if (apiKey) {
    if (provider === 'anthropic') {
      envVars.push(`ANTHROPIC_API_KEY=${apiKey}`);
    } else if (provider === 'openai') {
      envVars.push(`OPENAI_API_KEY=${apiKey}`);
    } else if (provider === 'azure-openai') {
      envVars.push(`AZURE_OPENAI_API_KEY=${apiKey}`);
      envVars.push(`AZURE_OPENAI_ENDPOINT=${baseUrl}`);
    }
  }

  if (envVars.length > 0) {
    const saveEnv = await promptConfirm('\nSave API keys to .env file?');
    if (saveEnv) {
      fs.writeFileSync(ENV_FILE, envVars.join('\n'), 'utf-8');
      console.log(`Environment file saved: ${ENV_FILE}`);
    }
  }

  // ========== Summary ==========
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           Configuration Complete!                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\nConfiguration Summary:');
  console.log(`  AI Provider:  ${provider}`);
  console.log(`  Model:        ${model}`);
  console.log(`  Owner ID:     ${ownerId || 'Not set'}`);
  console.log(`  Platforms:    ${platforms.length > 0 ? platforms.map(p => p.type).join(', ') : 'None'}`);

  console.log('\nNext steps:');
  console.log('  1. copy-clawd gateway --port 18789    # Start the bot');
  console.log('  2. Set up webhooks for your platforms');
  console.log('  3. Enjoy your AI assistant!');

  console.log('\nFor help: copy-clawd help\n');
}

async function configurePlatform(platformType: string): Promise<any> {
  const config: any = {
    type: platformType,
    enabled: true,
    config: {},
  };

  console.log(`\nConfiguring ${platformType}...`);

  switch (platformType) {
    case 'telegram':
      const tgToken = await promptInput('Bot Token (from @BotFather):', '');
      config.config.botToken = tgToken;
      break;

    case 'dingtalk':
      config.config.webhook = await promptInput('Webhook URL:', '');
      config.config.secret = await promptInput('Secret (optional):', '');
      break;

    case 'feishu':
      config.config.appId = await promptInput('App ID:', '');
      config.config.appSecret = await promptInput('App Secret:', '');
      config.config.verificationToken = await promptInput('Verification Token (optional):', '');
      break;

    case 'wechat-work':
      config.config.corpId = await promptInput('Corp ID:', '');
      config.config.corpSecret = await promptInput('Corp Secret:', '');
      config.config.agentId = await promptInput('Agent ID:', '');
      config.config.encodingAESKey = await promptInput('Encoding AES Key (optional):', '');
      break;

    case 'slack':
      config.config.botToken = await promptInput('Bot Token (xoxb-...):', '');
      config.config.signingSecret = await promptInput('Signing Secret:', '');
      break;

    case 'discord':
      config.config.botToken = await promptInput('Bot Token:', '');
      config.config.publicKey = await promptInput('Public Key (optional):', '');
      break;
  }

  return config;
}

async function installDaemon(): Promise<void> {
  console.log('Installing daemon service...');
  console.log(`Platform: ${process.platform}`);
  console.log(`Config dir: ${CONFIG_DIR}`);
  console.log('');

  const serviceContent = `[Unit]
Description=Copy-Clawd Bot
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=${CONFIG_DIR}
ExecStart=${process.cwd()}/node_modules/.bin/tsx ${process.cwd()}/src/commands/gateway.ts
Restart=always

[Install]
WantedBy=multi-user.target
`;

  console.log('Service configuration:');
  console.log(serviceContent);

  console.log('\nTo install as a systemd service:');
  console.log('1. Save the service file to /etc/systemd/system/copy-clawd.service');
  console.log('2. Run: sudo systemctl daemon-reload');
  console.log('3. Run: sudo systemctl enable copy-clawd');
  console.log('4. Run: sudo systemctl start copy-clawd');
}

async function promptInput(question: string, defaultValue: string): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const questionText = defaultValue
      ? `${question} [${defaultValue}]: `
      : `${question}: `;

    rl.question(questionText, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function promptChoice(question: string, choices: { value: string; label: string }[]): Promise<string> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(question);
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice.label}`);
  });

  return new Promise((resolve) => {
    rl.question('Enter number: ', (answer) => {
      rl.close();
      const index = parseInt(answer, 10) - 1;
      if (index >= 0 && index < choices.length) {
        resolve(choices[index].value);
      } else {
        resolve(choices[0].value);
      }
    });
  });
}

async function promptConfirm(question: string): Promise<boolean> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
