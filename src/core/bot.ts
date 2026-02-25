import { Message, AIMessage, AIProvider, PlatformAdapter, PlatformConfig, AgentConfig } from '../types/index.js';
import { createAIProvider } from '../ai-providers/index.js';
import { createPlatformAdapter } from '../platforms/index.js';
import { pairingManager } from './pairing.js';
import { toolManager } from './tools.js';

export interface BotConfig {
  agent: AgentConfig;
  platforms: PlatformConfig[];
  systemPrompt?: string;
  ownerId?: string;  // Owner user ID who can approve pairing requests
  enableTools?: boolean;  // Enable computer control tools
}

export class Bot {
  private aiProvider: AIProvider;
  private platformAdapters: Map<string, PlatformAdapter> = new Map();
  private messageHistory: Map<string, AIMessage[]> = new Map();
  private systemPrompt: string;
  private ownerId?: string;
  private requirePairing: boolean = true;
  private enableTools: boolean = false;

  constructor(config: BotConfig) {
    this.aiProvider = createAIProvider(config.agent.provider || 'anthropic', config.agent);
    this.systemPrompt = config.systemPrompt || 'You are a helpful AI assistant.';
    this.ownerId = config.ownerId;
    this.enableTools = config.enableTools ?? false;

    // Initialize platform adapters
    for (const platformConfig of config.platforms) {
      if (platformConfig.enabled) {
        const adapter = createPlatformAdapter(platformConfig.type);
        adapter.onMessage(this.handleMessage.bind(this));
        this.platformAdapters.set(platformConfig.type, adapter);
      }
    }
  }

  async start(): Promise<void> {
    console.log('Starting Bot...');

    // Initialize and start all platform adapters
    for (const [type, adapter] of this.platformAdapters) {
      try {
        const platformConfig = this.getPlatformConfig(type);
        if (platformConfig) {
          await adapter.initialize(platformConfig.config);
          await adapter.start();
        }
      } catch (error) {
        console.error(`[${type}] Failed to start:`, error);
      }
    }

    console.log('Bot started successfully');
  }

  async stop(): Promise<void> {
    console.log('Stopping Bot...');

    for (const [type, adapter] of this.platformAdapters) {
      try {
        await adapter.stop();
      } catch (error) {
        console.error(`[${type}] Failed to stop:`, error);
      }
    }

    console.log('Bot stopped');
  }

  private getPlatformConfig(type: string): PlatformConfig | undefined {
    // This would need to be passed in constructor
    return undefined;
  }

  /**
   * Handle incoming message - public method for external adapters
   */
  async handleMessage(message: Message): Promise<void> {
    console.log(`[${message.platform}] Received message from ${message.sender}: ${message.content}`);

    // Check if pairing is required
    if (this.requirePairing && !pairingManager.isApproved(message.platform, message.sender)) {
      const adapter = this.platformAdapters.get(message.platform);
      if (adapter) {
        // Check if this is a pairing command
        if (message.content.startsWith('pair ') || message.content.startsWith('/pair')) {
          // Generate pairing code for user
          const code = pairingManager.createPairingCode(message.platform, message.sender);
          await adapter.sendMessage(message.sender,
            `Pairing code: ${code}\nAsk the bot owner to approve with:\ncopy-clawd pairing approve ${message.platform} ${code}`
          );
          return;
        }

        // Check if this is an owner approval command
        if (message.content.startsWith('pairing approve ') && message.sender === this.ownerId) {
          // Handle owner approval command
          const parts = message.content.split(' ');
          if (parts.length >= 3) {
            const platform = parts[1];
            const code = parts[2];
            const result = pairingManager.approveByCode(code);
            await adapter.sendMessage(message.sender, result.message);
          }
          return;
        }

        // User not approved - send pairing instructions
        await adapter.sendMessage(message.sender,
          `Access not configured.\n\nYour ${message.platform} user id: ${message.sender}\n\nPairing code: ${pairingManager.createPairingCode(message.platform, message.sender)}\n\nAsk the bot owner to approve with:\ncopy-clawd pairing approve ${message.platform} <code>`
        );
      }
      return;
    }

    // Handle pairing management commands from owner
    if (message.sender === this.ownerId && message.content.startsWith('pairing ')) {
      await this.handlePairingCommand(message);
      return;
    }

    // Handle tool commands (only owner can use tools)
    if (this.enableTools && message.sender === this.ownerId) {
      const toolResult = await this.handleToolCommand(message.content);
      if (toolResult) {
        const adapter = this.platformAdapters.get(message.platform);
        if (adapter) {
          await adapter.sendMessage(message.sender, toolResult);
        }
        return;
      }
    }

    try {
      // Get conversation history
      const history = this.messageHistory.get(message.conversationId || message.sender) || [];

      // Add user message
      history.push({
        role: 'user',
        content: message.content,
      });

      // Build messages for AI
      const aiMessages: AIMessage[] = [
        { role: 'system', content: this.systemPrompt },
        ...history,
      ];

      // Call AI
      const response = await this.aiProvider.chat(aiMessages, {
        model: 'claude-sonnet-4-6',
        maxTokens: 4096,
      });

      // Send response back to platform
      const adapter = this.platformAdapters.get(message.platform);
      if (adapter) {
        await adapter.sendMessage(message.sender, response.content);
      }

      // Add assistant response to history
      history.push({
        role: 'assistant',
        content: response.content,
      });

      // Keep history limited
      if (history.length > 50) {
        history.splice(0, history.length - 50);
      }

      this.messageHistory.set(message.conversationId || message.sender, history);
    } catch (error) {
      console.error(`[${message.platform}] Error handling message:`, error);
    }
  }

  private async handlePairingCommand(message: Message): Promise<void> {
    const adapter = this.platformAdapters.get(message.platform);
    if (!adapter) return;

    const parts = message.content.split(' ');
    if (parts.length < 2) {
      await adapter.sendMessage(message.sender, 'Usage: pairing <approve|reject|list|revoke> [platform] [code/userId]');
      return;
    }

    const action = parts[1];

    switch (action) {
      case 'approve':
        if (parts.length >= 4) {
          // const platform = parts[2]; // platform is stored in the code itself
          const code = parts[3];
          const result = pairingManager.approveByCode(code);
          await adapter.sendMessage(message.sender, result.message);
        } else {
          await adapter.sendMessage(message.sender, 'Usage: pairing approve <platform> <code>');
        }
        break;

      case 'reject':
        if (parts.length >= 4) {
          const platform = parts[2];
          const userId = parts[3];
          pairingManager.removeUser(platform, userId);
          await adapter.sendMessage(message.sender, `User ${userId} rejected`);
        } else {
          await adapter.sendMessage(message.sender, 'Usage: pairing reject <platform> <userId>');
        }
        break;

      case 'list':
        const users = pairingManager.getPairedUsers();
        if (users.length === 0) {
          await adapter.sendMessage(message.sender, 'No paired users');
        } else {
          const list = users.map(u => `${u.platform}:${u.userId} (${u.approved ? 'approved' : 'pending'})`).join('\n');
          await adapter.sendMessage(message.sender, `Paired users:\n${list}`);
        }
        break;

      case 'revoke':
        if (parts.length >= 4) {
          const platform = parts[2];
          const userId = parts[3];
          pairingManager.removeUser(platform, userId);
          await adapter.sendMessage(message.sender, `User ${userId} revoked`);
        } else {
          await adapter.sendMessage(message.sender, 'Usage: pairing revoke <platform> <userId>');
        }
        break;

      default:
        await adapter.sendMessage(message.sender, 'Unknown pairing command. Use: approve, reject, list, revoke');
    }
  }

  private async handleToolCommand(content: string): Promise<string | null> {
    // Check if message starts with a tool command prefix
    if (!content.startsWith('!') && !content.startsWith('/run ') && !content.startsWith('shell ')) {
      return null;
    }

    // Parse command
    let toolName = 'shell';
    let args: Record<string, any> = {};

    if (content.startsWith('!')) {
      // Short form: !command args
      const parts = content.slice(1).split(' ');
      toolName = parts[0];
      args.command = parts.slice(1).join(' ');
    } else if (content.startsWith('/run ')) {
      const parts = content.slice(5).split(' ');
      toolName = parts[0];
      args.command = parts.slice(1).join(' ');
    } else if (content.startsWith('shell ')) {
      args.command = content.slice(6);
    } else if (content.startsWith('read ')) {
      toolName = 'read_file';
      const parts = content.slice(5).split(' ');
      args.path = parts[0];
    } else if (content.startsWith('write ')) {
      toolName = 'write_file';
      // Format: write <filepath> <content>
      const match = content.slice(6).match(/^(\S+)\s+(.*)$/);
      if (match) {
        args.path = match[1];
        args.content = match[2];
      }
    } else if (content.startsWith('ls ') || content.startsWith('dir ')) {
      toolName = 'list_dir';
      args.path = content.split(' ').slice(1).join(' ') || '.';
    } else if (content.startsWith('pwd')) {
      toolName = 'cwd';
    } else if (content.startsWith('sysinfo')) {
      toolName = 'system_info';
    } else if (content.startsWith('tools')) {
      // List available tools
      const tools = toolManager.list();
      return 'Available tools:\n' + tools.map(t => `  ${t.name}: ${t.description}`).join('\n');
    }

    // Add command to args if shell tool
    if (toolName === 'shell' && !args.command) {
      return null;
    }

    // Execute tool
    const result = await toolManager.execute(toolName, args);

    // Format response
    let response = '';
    if (result.success) {
      response = `✓ Success\n\n${result.output}`;
    } else {
      response = `✗ Error: ${result.error}`;
    }

    if (result.metadata) {
      response += `\n\n${JSON.stringify(result.metadata)}`;
    }

    // Truncate if too long
    if (response.length > 4000) {
      response = response.slice(0, 4000) + '\n\n... (truncated)';
    }

    return response;
  }

  async sendMessage(platform: string, to: string, content: string): Promise<void> {
    const adapter = this.platformAdapters.get(platform);
    if (!adapter) {
      throw new Error(`Platform ${platform} is not configured`);
    }

    await adapter.sendMessage(to, content);
  }

  async chat(message: string): Promise<string> {
    const aiMessages: AIMessage[] = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: message },
    ];

    const response = await this.aiProvider.chat(aiMessages);
    return response.content;
  }

  getPlatformAdapters(): Map<string, PlatformAdapter> {
    return this.platformAdapters;
  }

  clearHistory(conversationId?: string): void {
    if (conversationId) {
      this.messageHistory.delete(conversationId);
    } else {
      this.messageHistory.clear();
    }
  }
}
