import { Message, AIMessage, AIProvider, AIContentBlock, PlatformAdapter, PlatformConfig, AgentConfig, ChatOptions, ImageAttachment } from '../types/index.js';
import { createAIProvider } from '../ai-providers/index.js';
import { pairingManager } from './pairing.js';
import { toolManager } from './tools.js';
import fs from 'fs';
import path from 'path';

const MAX_TOOL_ROUNDS = 10;
const MAX_HISTORY = 30;
const MEMORY_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.copy-clawd', 'memory');

export interface BotConfig {
  agent: AgentConfig;
  platforms: PlatformConfig[];
  systemPrompt?: string;
  ownerId?: string;
  enableTools?: boolean;
}

export class Bot {
  private aiProvider: AIProvider;
  private platformAdapters: Map<string, PlatformAdapter> = new Map();
  private messageHistory: Map<string, AIMessage[]> = new Map();
  private systemPrompt: string;
  private ownerId?: string;
  private requirePairing: boolean = true;
  private enableTools: boolean = false;
  private agentConfig: AgentConfig;
  private isAnthropicProvider: boolean;

  constructor(config: BotConfig) {
    this.agentConfig = config.agent;
    this.aiProvider = createAIProvider(config.agent.provider || 'anthropic', config.agent);
    this.enableTools = config.enableTools ?? false;
    this.ownerId = config.ownerId || process.env.BOT_OWNER_ID;

    const p = config.agent.provider || 'anthropic';
    this.isAnthropicProvider = p === 'anthropic' || p === 'anthropic-api';

    if (!this.ownerId) {
      this.requirePairing = false;
    }

    this.systemPrompt = this.buildSystemPrompt(config.systemPrompt);
  }

  registerAdapter(adapter: PlatformAdapter): void {
    this.platformAdapters.set(adapter.type, adapter);
  }

  /**
   * Load recent memories to inject into conversation context.
   * Returns a brief context string with recent memory entries.
   */
  private loadRecentMemories(): string {
    if (!fs.existsSync(MEMORY_DIR)) return '';

    try {
      const files = this.findMarkdownFilesRecursive(MEMORY_DIR);
      if (files.length === 0) return '';

      // Sort by modification time (newest first), take top 10
      const sorted = files
        .map(f => ({ path: f, mtime: fs.statSync(f).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 10);

      const snippets: string[] = [];
      let totalLen = 0;
      const MAX_MEMORY_CHARS = 2000;

      for (const file of sorted) {
        const content = fs.readFileSync(file.path, 'utf-8');
        // Take first 300 chars of each file
        const snippet = content.slice(0, 300).trim();
        if (totalLen + snippet.length > MAX_MEMORY_CHARS) break;

        const rel = path.relative(MEMORY_DIR, file.path).replace(/\\/g, '/');
        snippets.push(`[${rel}]\n${snippet}`);
        totalLen += snippet.length;
      }

      if (snippets.length === 0) return '';
      return `\n\nRECENT MEMORIES (for context):\n${snippets.join('\n---\n')}`;
    } catch {
      return '';
    }
  }

  private findMarkdownFilesRecursive(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.findMarkdownFilesRecursive(full));
        } else if (entry.name.endsWith('.md')) {
          results.push(full);
        }
      }
    } catch { /* skip */ }
    return results;
  }

  private buildSystemPrompt(customPrompt?: string): string {
    const base = customPrompt || 'You are Copy-Clawd, a helpful AI assistant running locally on the user\'s machine.';

    if (!this.enableTools) return base;

    const toolInstructions = this.isAnthropicProvider
      ? '' // Anthropic uses native tool_use, tool descriptions come from tool definitions
      : `

IMPORTANT RULES FOR TOOL USAGE:
1. To use a tool, output EXACTLY this format:
<tool_call>
{"name": "tool_name", "args": {"param": "value"}}
</tool_call>
2. Only output ONE tool_call per response.
3. After receiving a tool result, you MUST respond to the user with the information. Do NOT call another tool unless the first one failed.
4. NEVER call the same tool twice with the same arguments.
5. If a tool succeeds, summarize the result for the user immediately. Do NOT try alternative approaches.`;

    return `${base}

You are running LOCALLY on the user's computer. You have direct access to their system through tools.
Do NOT say you cannot access the system — you CAN. Always use tools when the user asks you to do something on their machine.

Available tools:
- shell: Execute any shell command. Args: {"command": "...", "cwd": "...(optional)"}
- read_file: Read file contents. Args: {"path": "..."}
- write_file: Write to a file. Args: {"path": "...", "content": "..."}
- list_dir: List directory. Args: {"path": "...(optional)"}
- system_info: Get OS/CPU/memory/network info. Args: {}
- process_list: List running processes. Args: {"filter": "...(optional)"}
- process_kill: Kill a process. Args: {"pid": 123} or {"name": "..."}
- network_info: Network info. Args: {"action": "interfaces|connections|ping|ports"}
- open: Open URL/file/app. Args: {"target": "..."}
- clipboard: Read or write clipboard. Args: {"action": "read|write", "text": "...(for write)"}
- disk_usage: Check disk space. Args: {}
- search_files: Search files. Args: {"query": "...", "type": "filename|content"}
- env: Environment variables. Args: {"action": "list|get|set", "name": "...", "value": "..."}
- screenshot: Take a desktop screenshot. Args: {}
- web_browse: Browse a URL and extract text content. Args: {"url": "https://...", "selector": "article(optional)", "waitFor": 2000(optional ms)}
- memory_save: Save important info to long-term memory. Args: {"content": "...", "category": "user|project|facts|preferences|notes", "title": "..."}
- memory_search: Search through saved memories. Args: {"query": "...", "category": "...(optional)", "maxResults": 5}
- memory_get: Read a specific memory file. Args: {"path": "relative/path.md"}
- memory_list: List all saved memory files. Args: {"category": "...(optional)"}
${toolInstructions}
When the user asks you to do something on their computer, use the appropriate tools directly.
If a command might be destructive (deleting files, killing processes), warn the user first.
Keep responses concise. Do not explain your thinking or reasoning — just do it and report the result.

MEMORY INSTRUCTIONS:
- Proactively save important information to memory: user preferences, project details, frequently used paths, key facts the user tells you.
- When the user mentions something that might be useful later (their name, preferences, project info, etc.), save it using memory_save.
- Before answering questions about the user or their setup, search memory first using memory_search.
- Categories: "user" for personal info/preferences, "project" for project-related context, "facts" for important facts, "preferences" for settings/preferences, "notes" for general notes.`;
  }

  async start(): Promise<void> {
    console.log('Starting Bot...');
    console.log(`Registered adapters: ${Array.from(this.platformAdapters.keys()).join(', ') || 'none'}`);
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

  async handleMessage(message: Message): Promise<void> {
    const chatId = message.conversationId || message.sender;
    const imageIndicator = message.images?.length ? ` [+${message.images.length} image(s)]` : '';
    console.log(`[${message.platform}] Message from ${message.sender}: ${message.content.slice(0, 80)}${imageIndicator}`);

    const adapter = this.platformAdapters.get(message.platform);
    if (!adapter) return;

    // ── Pairing check ──
    if (this.requirePairing && !this.isOwner(message.sender) && !pairingManager.isApproved(message.platform, message.sender)) {
      if (message.content.startsWith('pair') || message.content.startsWith('/pair')) {
        const code = pairingManager.createPairingCode(message.platform, message.sender);
        await adapter.sendMessage(chatId,
          `Pairing code: ${code}\nAsk the bot owner to approve:\npairing approve ${message.platform} ${code}`);
        return;
      }
      const code = pairingManager.createPairingCode(message.platform, message.sender);
      await adapter.sendMessage(chatId,
        `Access not configured.\n\nYour ID: ${message.sender}\nPairing code: ${code}\n\nSend "pair" to request access.`);
      return;
    }

    // ── Pairing management (owner only) ──
    if (this.isOwner(message.sender) && message.content.startsWith('pairing ')) {
      await this.handlePairingCommand(message);
      return;
    }

    // ── Bot commands ──
    if (message.content === '/reset' || message.content === '/clear') {
      this.messageHistory.delete(chatId);
      await adapter.sendMessage(chatId, 'Conversation history cleared.');
      return;
    }

    if (message.content === '/status') {
      const history = this.messageHistory.get(chatId) || [];
      const tools = this.enableTools ? toolManager.list() : [];
      await adapter.sendMessage(chatId, [
        `Provider: ${this.agentConfig.provider || 'anthropic'}`,
        `Model: ${this.agentConfig.model}`,
        `History: ${history.length} messages`,
        `Tools: ${this.enableTools ? `${tools.length} available` : 'disabled'}`,
      ].join('\n'));
      return;
    }

    if (message.content === '/tools') {
      if (!this.enableTools) {
        await adapter.sendMessage(chatId, 'Tools are disabled.');
        return;
      }
      const tools = toolManager.list();
      const list = tools.map(t => `  ${t.name} - ${t.description}`).join('\n');
      await adapter.sendMessage(chatId, `Available tools:\n${list}`);
      return;
    }

    await this.sendTypingAction(adapter, chatId);

    try {
      let response: string;
      if (this.isAnthropicProvider) {
        response = await this.runAnthropicAgentLoop(chatId, message.content, adapter, message.images);
      } else {
        response = await this.runTextAgentLoop(chatId, message.content, adapter, message.images);
      }
      if (response) {
        await this.sendLongMessage(adapter, chatId, response);
      }
    } catch (error: any) {
      console.error(`[${message.platform}] Error:`, error.message);
      await adapter.sendMessage(chatId, `Error: ${error.message}`);
    }
  }

  /**
   * Build user message content, optionally including images as content blocks.
   */
  private buildUserContent(text: string, images?: ImageAttachment[]): string | AIContentBlock[] {
    if (!images || images.length === 0) {
      return text;
    }

    const blocks: AIContentBlock[] = [];

    for (const img of images) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64,
        },
      });
    }

    if (text) {
      blocks.push({ type: 'text', text });
    }

    return blocks;
  }

  /**
   * Anthropic-native tool_use loop
   */
  private async runAnthropicAgentLoop(conversationId: string, userMessage: string, adapter?: PlatformAdapter, images?: ImageAttachment[]): Promise<string> {
    const history = this.messageHistory.get(conversationId) || [];
    history.push({ role: 'user', content: this.buildUserContent(userMessage, images) });

    const memoryContext = this.loadRecentMemories();
    const chatOptions: ChatOptions = {
      model: this.agentConfig.model,
      maxTokens: this.agentConfig.maxTokens || 4096,
      temperature: this.agentConfig.temperature,
      systemPrompt: this.systemPrompt + memoryContext,
    };

    if (this.enableTools) {
      chatOptions.tools = toolManager.getToolDefinitions();
    }

    let finalText = '';
    let rounds = 0;
    let currentMessages: AIMessage[] = [...history];

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const response = await this.aiProvider.chat(currentMessages, chatOptions);

      if (!response.toolUse || response.toolUse.length === 0 || response.stopReason !== 'tool_use') {
        finalText = response.content;
        break;
      }

      const assistantContent: AIContentBlock[] = response.rawContent || [];
      currentMessages.push({ role: 'assistant', content: assistantContent });

      // Execute tools
      const toolResults: AIContentBlock[] = [];
      for (const toolUse of response.toolUse) {
        console.log(`[Agent] Tool: ${toolUse.name}(${JSON.stringify(toolUse.input).slice(0, 100)})`);
        const result = await toolManager.execute(toolUse.name!, toolUse.input || {});

        // Send screenshot as photo
        if (result.filePath && adapter && 'sendPhoto' in adapter) {
          try {
            await (adapter as any).sendPhoto(conversationId, result.filePath, result.output);
          } catch (err: any) {
            console.error(`[Agent] Send photo failed:`, err.message);
          }
        }

        if (adapter) await this.sendTypingAction(adapter, conversationId);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.success ? result.output : `Error: ${result.error}\n${result.output}`,
          is_error: !result.success,
        });
      }

      currentMessages.push({ role: 'user', content: toolResults });
    }

    history.push({ role: 'assistant', content: finalText });
    this.trimAndSaveHistory(conversationId, history);
    return finalText;
  }

  /**
   * Text-based tool calling loop for non-Anthropic providers (MiniMax, OpenAI, etc.)
   * The AI outputs <tool_call>{"name":"...", "args":{...}}</tool_call> in its response.
   * We parse it, execute the tool, and feed the result back for multi-step chaining.
   */
  private async runTextAgentLoop(conversationId: string, userMessage: string, adapter?: PlatformAdapter, images?: ImageAttachment[]): Promise<string> {
    const history = this.messageHistory.get(conversationId) || [];
    history.push({ role: 'user', content: this.buildUserContent(userMessage, images) });

    const memoryContext = this.loadRecentMemories();
    const chatOptions: ChatOptions = {
      model: this.agentConfig.model,
      maxTokens: this.agentConfig.maxTokens || 4096,
      temperature: this.agentConfig.temperature,
      systemPrompt: this.systemPrompt + memoryContext,
    };

    let rounds = 0;
    let currentMessages: AIMessage[] = [...history];

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const response = await this.aiProvider.chat(currentMessages, chatOptions);
      const text = response.content;

      // Try to parse <tool_call> from the response
      const toolCall = this.parseToolCall(text);

      if (!toolCall) {
        // No tool call — this is the final response
        const cleanText = this.cleanResponse(text);
        history.push({ role: 'assistant', content: cleanText });
        this.trimAndSaveHistory(conversationId, history);
        return cleanText;
      }

      // Execute the tool
      console.log(`[Agent] Tool: ${toolCall.name}(${JSON.stringify(toolCall.args).slice(0, 100)})`);
      const result = await toolManager.execute(toolCall.name, toolCall.args);

      // Send screenshot as photo
      if (result.filePath && adapter && 'sendPhoto' in adapter) {
        try {
          await (adapter as any).sendPhoto(conversationId, result.filePath, result.output);
        } catch (err: any) {
          console.error(`[Agent] Send photo failed:`, err.message);
        }
      }

      if (adapter) await this.sendTypingAction(adapter, conversationId);

      // Feed tool result back to the AI for next round
      currentMessages.push({ role: 'assistant', content: text });
      if (result.success) {
        currentMessages.push({
          role: 'user',
          content: `[Tool "${toolCall.name}" result]\n${result.output}\n[End of result]\n\nContinue with the task. If you need another tool, use tool_call. Otherwise respond directly to the user (no tool_call tags).`,
        });
      } else {
        currentMessages.push({
          role: 'user',
          content: `Tool "${toolCall.name}" failed: ${result.error}\n${result.output}\nTry a different approach or respond to the user.`,
        });
      }
    }

    // Max rounds reached — force a final summary
    const summaryResult = await this.forceSummaryResponse(
      currentMessages, '', 'multiple tools', 'Max tool rounds reached', chatOptions
    );
    history.push({ role: 'assistant', content: summaryResult });
    this.trimAndSaveHistory(conversationId, history);
    return summaryResult;
  }

  /**
   * Force the AI to produce a summary response — no tool calling allowed.
   * Uses a stripped-down system prompt without tool instructions.
   */
  private async forceSummaryResponse(
    previousMessages: AIMessage[],
    assistantToolText: string,
    toolName: string,
    toolOutput: string,
    baseOptions: ChatOptions,
  ): Promise<string> {
    const summaryMessages: AIMessage[] = [
      ...previousMessages,
      { role: 'assistant', content: assistantToolText },
      {
        role: 'user',
        content: `[Tool "${toolName}" executed successfully. Result below]\n${toolOutput}\n[End of result]\n\nBased on this result, provide a clear and concise response to the user. Do NOT use any tool_call tags. Just respond directly.`,
      },
    ];

    // Use a minimal system prompt — no tool instructions at all
    const summaryOptions: ChatOptions = {
      ...baseOptions,
      systemPrompt: 'You are a helpful assistant. Summarize the tool result and respond to the user concisely. Do NOT output any tool_call tags or XML tags. Respond in the same language as the user.',
    };

    const response = await this.aiProvider.chat(summaryMessages, summaryOptions);
    return this.cleanResponse(response.content);
  }

  /**
   * Parse <tool_call>{"name":"...", "args":{...}}</tool_call> from AI response text
   */
  private parseToolCall(text: string): { name: string; args: Record<string, any> } | null {
    const match = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.name && typeof parsed.name === 'string') {
        return { name: parsed.name, args: parsed.args || {} };
      }
    } catch {
      // JSON parse failed
    }
    return null;
  }

  /**
   * Remove tool_call blocks and thinking artifacts from final response
   */
  private cleanResponse(text: string): string {
    return text
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
      .trim();
  }

  private trimAndSaveHistory(conversationId: string, history: AIMessage[]): void {
    if (history.length > MAX_HISTORY * 2) {
      history.splice(0, history.length - MAX_HISTORY * 2);
    }
    this.messageHistory.set(conversationId, history);
  }

  private async sendTypingAction(adapter: PlatformAdapter, chatId: string): Promise<void> {
    try {
      if ('sendChatAction' in adapter) {
        await (adapter as any).sendChatAction(chatId, 'typing');
      }
    } catch { /* ignore */ }
  }

  private async sendLongMessage(adapter: PlatformAdapter, chatId: string, text: string): Promise<void> {
    const MAX_LEN = 4000;
    if (text.length <= MAX_LEN) {
      await adapter.sendMessage(chatId, text);
      return;
    }

    const chunks: string[] = [];
    let current = '';
    for (const line of text.split('\n')) {
      if ((current + '\n' + line).length > MAX_LEN) {
        if (current) chunks.push(current);
        current = line;
      } else {
        current = current ? current + '\n' + line : line;
      }
    }
    if (current) chunks.push(current);
    for (const chunk of chunks) {
      await adapter.sendMessage(chatId, chunk);
    }
  }

  private isOwner(sender: string): boolean {
    return this.ownerId !== undefined && sender === this.ownerId;
  }

  private async handlePairingCommand(message: Message): Promise<void> {
    const adapter = this.platformAdapters.get(message.platform);
    if (!adapter) return;

    const chatId = message.conversationId || message.sender;
    const parts = message.content.split(' ');
    if (parts.length < 2) {
      await adapter.sendMessage(chatId, 'Usage: pairing <approve|reject|list|revoke> [platform] [code/userId]');
      return;
    }

    const action = parts[1];
    switch (action) {
      case 'approve':
        if (parts.length >= 4) {
          const result = pairingManager.approveByCode(parts[3]);
          await adapter.sendMessage(chatId, result.message);
        } else {
          await adapter.sendMessage(chatId, 'Usage: pairing approve <platform> <code>');
        }
        break;
      case 'reject':
        if (parts.length >= 4) {
          pairingManager.removeUser(parts[2], parts[3]);
          await adapter.sendMessage(chatId, `User ${parts[3]} rejected`);
        }
        break;
      case 'list': {
        const users = pairingManager.getPairedUsers();
        if (users.length === 0) {
          await adapter.sendMessage(chatId, 'No paired users');
        } else {
          const list = users.map(u => `${u.platform}:${u.userId} (${u.approved ? 'approved' : 'pending'})`).join('\n');
          await adapter.sendMessage(chatId, `Paired users:\n${list}`);
        }
        break;
      }
      case 'revoke':
        if (parts.length >= 4) {
          pairingManager.removeUser(parts[2], parts[3]);
          await adapter.sendMessage(chatId, `User ${parts[3]} revoked`);
        }
        break;
      default:
        await adapter.sendMessage(chatId, 'Unknown pairing command. Use: approve, reject, list, revoke');
    }
  }

  async sendMessage(platform: string, to: string, content: string): Promise<void> {
    const adapter = this.platformAdapters.get(platform);
    if (!adapter) throw new Error(`Platform ${platform} is not configured`);
    await adapter.sendMessage(to, content);
  }

  async chat(message: string): Promise<string> {
    if (this.isAnthropicProvider) {
      return this.runAnthropicAgentLoop('cli-' + Date.now(), message);
    }
    return this.runTextAgentLoop('cli-' + Date.now(), message);
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
