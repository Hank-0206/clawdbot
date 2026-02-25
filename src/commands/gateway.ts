import { WebSocketServer, WebSocket } from 'ws';
import { configManager } from '../config/config.js';
import { Bot } from '../core/bot.js';

interface GatewayOptions {
  port?: number;
  verbose?: boolean;
}

const DEFAULT_PORT = 18789;

export async function runGateway() {
  const args = process.argv.slice(2);
  const options = parseOptions(args);

  console.log('Starting Copy-Clawd Gateway...');
  console.log(`Port: ${options.port || DEFAULT_PORT}`);

  // Load configuration
  const config = configManager.get();
  console.log('Loaded configuration:');
  console.log(`  AI Provider: ${config.agent.provider}`);
  console.log(`  Model: ${config.agent.model}`);

  // Create bot instance
  const bot = new Bot({
    agent: config.agent,
    platforms: config.platforms || [],
    systemPrompt: 'You are Copy-Clawd, a helpful AI assistant.',
  });

  // Start bot
  await bot.start();

  // Create WebSocket server
  const wss = new WebSocketServer({ port: options.port || DEFAULT_PORT });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[Gateway] Client connected');

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(ws, message, bot);
      } catch (error) {
        console.error('[Gateway] Failed to parse message:', error);
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      console.log('[Gateway] Client disconnected');
    });

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      version: '1.0.0',
    }));
  });

  wss.on('listening', () => {
    console.log(`[Gateway] Server listening on ws://127.0.0.1:${options.port || DEFAULT_PORT}`);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Gateway] Shutting down...');
    await bot.stop();
    wss.close();
    process.exit(0);
  });
}

function parseOptions(args: string[]): GatewayOptions {
  const options: GatewayOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      options.port = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    }
  }

  return options;
}

async function handleClientMessage(ws: WebSocket, message: any, bot: Bot): Promise<void> {
  const { type, ...data } = message;

  switch (type) {
    case 'chat':
      try {
        const response = await bot.chat(data.message);
        ws.send(JSON.stringify({
          type: 'chat_response',
          content: response,
        }));
      } catch (error: any) {
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message,
        }));
      }
      break;

    case 'send':
      try {
        await bot.sendMessage(data.platform, data.to, data.message);
        ws.send(JSON.stringify({
          type: 'sent',
          platform: data.platform,
          to: data.to,
        }));
      } catch (error: any) {
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message,
        }));
      }
      break;

    case 'list_platforms':
      const adapters = bot.getPlatformAdapters();
      ws.send(JSON.stringify({
        type: 'platforms',
        platforms: Array.from(adapters.keys()),
      }));
      break;

    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${type}`,
      }));
  }
}
