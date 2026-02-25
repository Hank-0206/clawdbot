#!/usr/bin/env node
import { configManager } from '../config/config.js';
import { Bot } from '../core/bot.js';
import { createPlatformAdapter } from '../platforms/index.js';
import { PlatformAdapter } from '../types/index.js';

interface StartOptions {
  port?: number;
  enableTools?: boolean;
  mode?: 'polling' | 'webhook';
}

/**
 * Start command - runs all services at once
 * For Telegram: uses Long Polling mode (no public URL needed)
 */
export async function runStart() {
  const args = process.argv.slice(2);
  const options = parseOptions(args);

  // Global error handlers
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
  });

  console.log(`
╔════════════════════════════════════════════════════════════╗
║              Copy-Clawd Bot - 启动中...                   ║
╚════════════════════════════════════════════════════════════╝
`);

  // Load configuration
  await configManager.load();
  const config = configManager.get();

  console.log('加载配置...');
  console.log(`  AI Provider: ${config.agent.provider}`);
  console.log(`  Model: ${config.agent.model}`);
  console.log(`  Enable Tools: ${options.enableTools ?? config.enableTools ?? false ? 'Yes' : 'No'}`);
  console.log(`  Owner ID: ${config.ownerId || 'Not set'}`);

  // Find Telegram platform config
  const telegramConfig = config.platforms?.find(p => p.type === 'telegram');

  if (!telegramConfig?.enabled) {
    console.log('\n⚠️  Telegram 未启用，请在配置中启用 Telegram');
    console.log('   运行: copy-clawd config --add-platform telegram');
    process.exit(1);
  }

  // Create bot instance
  const bot = new Bot({
    agent: config.agent,
    platforms: config.platforms || [],
    systemPrompt: config.systemPrompt || 'You are Copy-Clawd, a helpful AI assistant.',
    ownerId: config.ownerId,
    enableTools: options.enableTools ?? config.enableTools ?? false,
  });

  // Initialize and start Telegram adapter in polling mode
  const adapter = createPlatformAdapter('telegram');

  try {
    // Set mode to polling for local operation without public URL
    const adapterConfig = {
      ...telegramConfig.config,
      mode: options.mode || telegramConfig.config.mode || 'polling',
    };

    await adapter.initialize(adapterConfig);

    adapter.onMessage(async (message) => {
      console.log(`[${message.platform}] 收到消息 from ${message.sender}: ${message.content.substring(0, 50)}...`);

      try {
        // Handle message through bot logic
        await bot.handleMessage(message);
      } catch (error: any) {
        console.error(`[${message.platform}] 处理消息错误:`, error.message);
      }
    });

    await adapter.start();
  } catch (error: any) {
    console.error('❌ Telegram 启动失败:', error.message);
    process.exit(1);
  }

  console.log(`
✅ 启动成功！

📱 Telegram Bot 已启动 (Long Polling 模式)
   - 无需公网 URL
   - 直接从 Telegram 获取消息

🤖 AI: ${config.agent.provider} / ${config.agent.model}
${config.ownerId ? `👤 所有者 ID: ${config.ownerId}` : ''}

💬 现在可以给 Telegram Bot 发送消息了！

🔧 工具命令 (仅所有者):
   !<命令>        执行 shell 命令
   !ls           列出目录
   !pwd          显示当前路径

🛑 按 Ctrl+C 停止
`);

  // Keep the process running
  return new Promise(() => {
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n正在关闭...');
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
    } else if (arg === '--mode' && args[i + 1]) {
      options.mode = args[i + 1] as 'polling' | 'webhook';
      i++;
    }
  }

  return options;
}
