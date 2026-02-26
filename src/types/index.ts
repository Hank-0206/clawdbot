// Platform types
export type PlatformType = 'wechat' | 'wechat-work' | 'dingtalk' | 'feishu' | 'slack' | 'discord' | 'telegram';

// AI Provider types
export type AIProviderType = 'openai' | 'anthropic' | 'azure-openai' | 'anthropic-api' | 'openrouter' | 'opencode' | 'minimax';

export interface Config {
  agent: AgentConfig;
  platforms?: PlatformConfig[];
  workspace?: string;
  ownerId?: string;
  enableTools?: boolean;
  systemPrompt?: string;
}

export interface AgentConfig {
  model: string;
  provider?: AIProviderType;
  apiKey?: string;
  baseUrl?: string;
  groupId?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface PlatformConfig {
  type: PlatformType;
  enabled: boolean;
  config: Record<string, any>;
}

export interface ImageAttachment {
  base64: string;
  mediaType: string;
}

export interface Message {
  id: string;
  platform: PlatformType;
  sender: string;
  content: string;
  timestamp: number;
  chatId?: string;
  conversationId?: string;
  metadata?: Record<string, any>;
  images?: ImageAttachment[];
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | AIContentBlock[];
}

// Anthropic tool_use content blocks
export interface AIContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

// Tool definition for Anthropic API
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface AIResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: string;
  toolUse?: AIContentBlock[];  // tool_use blocks if stop_reason is tool_use
  rawContent?: AIContentBlock[];  // full content blocks
}

export interface PlatformAdapter {
  name: string;
  type: PlatformType;
  initialize(config: Record<string, any>): Promise<void>;
  sendMessage(to: string, content: string, options?: SendMessageOptions): Promise<void>;
  onMessage(handler: (message: Message) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface SendMessageOptions {
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  replyToMessageId?: string;
}

export interface AIProvider {
  name: string;
  type: AIProviderType;
  chat(messages: AIMessage[], options?: ChatOptions): Promise<AIResponse>;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
}
