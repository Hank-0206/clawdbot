// Platform types
export type PlatformType = 'wechat' | 'wechat-work' | 'dingtalk' | 'feishu' | 'slack' | 'discord' | 'telegram';

// AI Provider types
export type AIProviderType = 'openai' | 'anthropic' | 'azure-openai' | 'anthropic-api' | 'openrouter' | 'opencode' | 'minimax';

export interface Config {
  agent: AgentConfig;
  platforms?: PlatformConfig[];
  workspace?: string;
  ownerId?: string;  // Owner user ID who can approve pairing requests
  enableTools?: boolean;  // Enable computer control tools
  systemPrompt?: string;  // Custom system prompt
}

export interface AgentConfig {
  model: string;
  provider?: AIProviderType;
  apiKey?: string;
  baseUrl?: string;
  groupId?: string;  // For MiniMax
  maxTokens?: number;
  temperature?: number;
}

export interface PlatformConfig {
  type: PlatformType;
  enabled: boolean;
  config: Record<string, any>;
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
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface PlatformAdapter {
  name: string;
  type: PlatformType;
  initialize(config: Record<string, any>): Promise<void>;
  sendMessage(to: string, content: string): Promise<void>;
  onMessage(handler: (message: Message) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface AIProvider {
  name: string;
  type: AIProviderType;
  chat(messages: AIMessage[], options?: Record<string, any>): Promise<AIResponse>;
}
