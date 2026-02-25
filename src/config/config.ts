import fs from 'fs';
import path from 'path';
import { Config, PlatformConfig, AgentConfig, PlatformType, AIProviderType } from '../types/index.js';

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.copy-clawd');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

const DEFAULT_CONFIG: Config = {
  agent: {
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
  },
  platforms: [],
  workspace: CONFIG_DIR,
};

export class ConfigManager {
  private config: Config;

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  async load(): Promise<Config> {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
        // Simple YAML-like parsing
        const loaded = this.parseConfig(content);
        this.config = { ...DEFAULT_CONFIG, ...loaded };
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
    return this.config;
  }

  async save(): Promise<void> {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      const content = this.stringifyConfig(this.config);
      fs.writeFileSync(CONFIG_FILE, content, 'utf-8');
    } catch (error) {
      console.error('Failed to save config:', error);
      throw error;
    }
  }

  get(): Config {
    return this.config;
  }

  update(config: Partial<Config>): void {
    this.config = { ...this.config, ...config };
  }

  getAgentConfig(): AgentConfig {
    return this.config.agent;
  }

  getPlatformConfigs(): PlatformConfig[] {
    return this.config.platforms || [];
  }

  addPlatform(platform: PlatformConfig): void {
    const platforms = this.config.platforms || [];
    const existing = platforms.findIndex(p => p.type === platform.type);
    if (existing >= 0) {
      platforms[existing] = platform;
    } else {
      platforms.push(platform);
    }
    this.config.platforms = platforms;
  }

  removePlatform(type: PlatformType): void {
    this.config.platforms = (this.config.platforms || []).filter(p => p.type !== type);
  }

  private parseConfig(content: string): Partial<Config> {
    const config: Partial<Config> = {};
    const lines = content.split('\n');
    let currentSection: string | null = null;
    let currentObj: any = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed === 'agent:') {
        currentSection = 'agent';
        currentObj = {};
      } else if (trimmed === 'platforms:') {
        currentSection = 'platforms';
        currentObj = [];
      } else if (trimmed.startsWith('model:')) {
        currentObj.model = trimmed.replace('model:', '').trim().replace(/['"]/g, '');
      } else if (trimmed.startsWith('provider:')) {
        currentObj.provider = trimmed.replace('provider:', '').trim().replace(/['"]/g, '') as AIProviderType;
      } else if (trimmed.startsWith('apiKey:') || trimmed.startsWith('api_key:')) {
        currentObj.apiKey = trimmed.replace(/apiKey:|api_key:/, '').trim().replace(/['"]/g, '');
      } else if (trimmed.startsWith('baseUrl:') || trimmed.startsWith('base_url:')) {
        currentObj.baseUrl = trimmed.replace(/baseUrl:|base_url:/, '').trim().replace(/['"]/g, '');
      }

      if (currentSection === 'agent' && Object.keys(currentObj).length > 0) {
        config.agent = currentObj;
      }
    }

    return config;
  }

  private stringifyConfig(config: Config): string {
    const lines: string[] = [
      '# Copy-Clawd Bot Configuration',
      '',
      'agent:',
      `  model: ${config.agent.model}`,
      `  provider: ${config.agent.provider || 'anthropic'}`,
    ];

    if (config.agent.apiKey) {
      lines.push(`  apiKey: "${config.agent.apiKey}"`);
    }
    if (config.agent.baseUrl) {
      lines.push(`  baseUrl: "${config.agent.baseUrl}"`);
    }

    if (config.platforms && config.platforms.length > 0) {
      lines.push('');
      lines.push('platforms:');
      for (const platform of config.platforms) {
        lines.push(`  - type: ${platform.type}`);
        lines.push(`    enabled: ${platform.enabled}`);
      }
    }

    return lines.join('\n');
  }
}

export const configManager = new ConfigManager();
