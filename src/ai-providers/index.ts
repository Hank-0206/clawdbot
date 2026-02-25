import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AIProvider, AIResponse, AIMessage, AIProviderType, AgentConfig } from '../types/index.js';

export class AnthropicProvider implements AIProvider {
  name = 'Anthropic Claude';
  type: AIProviderType = 'anthropic';
  private client: Anthropic;

  constructor(config: AgentConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || '',
    });
  }

  async chat(messages: AIMessage[], options: Record<string, any> = {}): Promise<AIResponse> {
    const response = await this.client.messages.create({
      model: options.model || 'claude-sonnet-4-6',
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 1,
      system: messages.find(m => m.role === 'system')?.content,
      messages: messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    return {
      content: response.content[0].type === 'text' ? response.content[0].text : '',
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

export class OpenAIProvider implements AIProvider {
  name = 'OpenAI';
  type: AIProviderType = 'openai';
  private client: OpenAI;

  constructor(config: AgentConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || '',
      baseURL: config.baseUrl || process.env.OPENAI_BASE_URL || undefined,
    });
  }

  async chat(messages: AIMessage[], options: Record<string, any> = {}): Promise<AIResponse> {
    const response = await this.client.chat.completions.create({
      model: options.model || 'gpt-4o',
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 1,
      messages: messages as any,
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

export class AzureOpenAIProvider implements AIProvider {
  name = 'Azure OpenAI';
  type: AIProviderType = 'azure-openai';
  private client: OpenAI;

  constructor(config: AgentConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.AZURE_OPENAI_API_KEY || '',
      baseURL: config.baseUrl || process.env.AZURE_OPENAI_ENDPOINT || '',
      defaultQuery: {
        'api-version': '2024-02-01',
      },
    });
  }

  async chat(messages: AIMessage[], options: Record<string, any> = {}): Promise<AIResponse> {
    const deploymentName = options.deploymentName || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4';

    const response = await this.client.chat.completions.create({
      model: deploymentName,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 1,
      messages: messages as any,
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
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'azure-openai':
      return new AzureOpenAIProvider(config);
    default:
      throw new Error(`Unknown AI provider type: ${type}`);
  }
}
