import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AIProvider, AIResponse, AIMessage, AIProviderType, AgentConfig, ChatOptions, AIContentBlock } from '../types/index.js';

/**
 * Build OpenAI-compatible messages array, prepending systemPrompt if provided.
 */
function buildOpenAIMessages(messages: AIMessage[], options: ChatOptions = {}): any[] {
  const result: any[] = [];

  if (options.systemPrompt) {
    result.push({ role: 'system', content: options.systemPrompt });
  }

  for (const m of messages) {
    // Skip system messages from the original array (we already handle systemPrompt above)
    if (m.role === 'system') continue;

    if (typeof m.content === 'string') {
      result.push({ role: m.role, content: m.content });
    } else {
      // Convert content blocks to OpenAI format (supports vision)
      const openaiContent: any[] = [];
      for (const block of m.content) {
        if (block.type === 'text') {
          openaiContent.push({ type: 'text', text: block.text || '' });
        } else if (block.type === 'image' && block.source) {
          openaiContent.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          });
        } else {
          openaiContent.push({ type: 'text', text: JSON.stringify(block) });
        }
      }
      result.push({ role: m.role, content: openaiContent });
    }
  }

  return result;
}

export class AnthropicProvider implements AIProvider {
  name = 'Anthropic Claude';
  type: AIProviderType = 'anthropic';
  private client: Anthropic;
  private defaultModel: string;

  constructor(config: AgentConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || '',
      baseURL: config.baseUrl || undefined,
    });
    this.defaultModel = config.model || 'claude-sonnet-4-6';
  }

  async chat(messages: AIMessage[], options: ChatOptions = {}): Promise<AIResponse> {
    // Extract system prompt
    const systemPrompt = options.systemPrompt ||
      messages.find(m => m.role === 'system')?.content as string | undefined;

    // Convert messages (filter out system messages)
    const apiMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Build request params
    const params: Anthropic.MessageCreateParams = {
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 1,
      messages: apiMessages as any,
    };

    if (systemPrompt) {
      params.system = systemPrompt;
    }

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      params.tools = options.tools as any;
    }

    const response = await this.client.messages.create(params);

    // Parse response content blocks
    const rawContent: AIContentBlock[] = [];
    const toolUseBlocks: AIContentBlock[] = [];
    let textContent = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
        rawContent.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        const toolBlock: AIContentBlock = {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, any>,
        };
        toolUseBlocks.push(toolBlock);
        rawContent.push(toolBlock);
      }
    }

    return {
      content: textContent,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason || undefined,
      toolUse: toolUseBlocks.length > 0 ? toolUseBlocks : undefined,
      rawContent: rawContent.length > 0 ? rawContent : undefined,
    };
  }
}

export class OpenAIProvider implements AIProvider {
  name = 'OpenAI';
  type: AIProviderType = 'openai';
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: AgentConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || '',
      baseURL: config.baseUrl || process.env.OPENAI_BASE_URL || undefined,
    });
    this.defaultModel = config.model || 'gpt-4o';
  }

  async chat(messages: AIMessage[], options: ChatOptions = {}): Promise<AIResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 1,
      messages: buildOpenAIMessages(messages, options) as any,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content || '',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
      stopReason: choice.finish_reason || undefined,
    };
  }
}

export class AzureOpenAIProvider implements AIProvider {
  name = 'Azure OpenAI';
  type: AIProviderType = 'azure-openai';
  private client: OpenAI;

  constructor(config: AgentConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.AZURE_OPENAI_API_KEY || '',
      baseURL: config.baseUrl || process.env.AZURE_OPENAI_ENDPOINT || '',
      defaultQuery: { 'api-version': '2024-02-01' },
    });
  }

  async chat(messages: AIMessage[], options: ChatOptions = {}): Promise<AIResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4',
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 1,
      messages: buildOpenAIMessages(messages, options) as any,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content || '',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }
}

export class OpenRouterProvider implements AIProvider {
  name = 'OpenRouter';
  type: AIProviderType = 'openrouter';
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: AgentConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENROUTER_API_KEY || '',
      baseURL: 'https://openrouter.ai/api/v1',
    });
    this.defaultModel = config.model || 'anthropic/claude-3.5-sonnet';
  }

  async chat(messages: AIMessage[], options: ChatOptions = {}): Promise<AIResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 1,
      messages: buildOpenAIMessages(messages, options) as any,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content || '',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }
}

export class OpenCodeProvider implements AIProvider {
  name = 'OpenCode';
  type: AIProviderType = 'opencode';
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: AgentConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENCODE_API_KEY || '',
      baseURL: config.baseUrl || process.env.OPENCODE_BASE_URL || 'https://opencode.ai/api/v1',
    });
    this.defaultModel = config.model || 'opencode/gpt-4o';
  }

  async chat(messages: AIMessage[], options: ChatOptions = {}): Promise<AIResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 1,
      messages: buildOpenAIMessages(messages, options) as any,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content || '',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }
}

export class MiniMaxProvider implements AIProvider {
  name = 'MiniMax';
  type: AIProviderType = 'minimax';
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: AgentConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.MINIMAX_API_KEY || '',
      baseURL: config.baseUrl || process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
    });
    this.defaultModel = config.model || 'MiniMax-M2.5';
  }

  async chat(messages: AIMessage[], options: ChatOptions = {}): Promise<AIResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      messages: buildOpenAIMessages(messages, options) as any,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 1,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content || '',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
      },
    };
  }
}

export function createAIProvider(type: AIProviderType, config: AgentConfig): AIProvider {
  switch (type) {
    case 'anthropic':
    case 'anthropic-api':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'azure-openai':
      return new AzureOpenAIProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'opencode':
      return new OpenCodeProvider(config);
    case 'minimax':
      return new MiniMaxProvider(config);
    default:
      throw new Error(`Unknown AI provider type: ${type}`);
  }
}
