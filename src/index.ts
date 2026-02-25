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
║              Copy-Clawd Bot - 个人 AI 助手                  ║
╚════════════════════════════════════════════════════════════╝

用法: copy-clawd <命令>

命令:
  gateway      启动网关服务器 (WebSocket)
  webhook      启动 webhook 服务器 (HTTP)
  agent        与 AI 对话
  message      通过平台发送消息
  onboard      首次配置向导
  config       管理配置
  pairing      管理用户配对/授权
  help         显示帮助信息

示例:
  copy-clawd onboard                 # 首次配置
  copy-clawd webhook --port 3000    # 启动 webhook 服务器
  copy-clawd gateway --port 18789   # 启动网关服务器
  copy-clawd agent --message "你好"  # 测试 AI 对话
  copy-clawd pairing approve JFY4PLJ6

工具命令 (仅 owner 可用):
  !<命令>        执行 shell 命令
  !ls           列出目录
  !pwd          显示当前路径
  !sysinfo      显示系统信息

环境变量:
  ANTHROPIC_API_KEY      Anthropic Claude API 密钥
  OPENAI_API_KEY         OpenAI API 密钥
  TELEGRAM_BOT_TOKEN     Telegram Bot Token

更多信息: https://github.com/Hank-0206/clawdbot
`);
}

main().catch(console.error);
