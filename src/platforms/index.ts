export { BasePlatformAdapter } from './base.js';
export { DingTalkAdapter } from './dingtalk.js';
export { FeishuAdapter } from './feishu.js';
export { WeChatWorkAdapter } from './wechat-work.js';
export { SlackAdapter } from './slack.js';
export { DiscordAdapter } from './discord.js';
export { TelegramAdapter } from './telegram.js';

import { PlatformAdapter, PlatformType } from '../types/index.js';
import { DingTalkAdapter } from './dingtalk.js';
import { FeishuAdapter } from './feishu.js';
import { WeChatWorkAdapter } from './wechat-work.js';
import { SlackAdapter } from './slack.js';
import { DiscordAdapter } from './discord.js';
import { TelegramAdapter } from './telegram.js';

export function createPlatformAdapter(type: PlatformType): PlatformAdapter {
  switch (type) {
    case 'dingtalk':
      return new DingTalkAdapter();
    case 'feishu':
      return new FeishuAdapter();
    case 'wechat-work':
      return new WeChatWorkAdapter();
    case 'slack':
      return new SlackAdapter();
    case 'discord':
      return new DiscordAdapter();
    case 'telegram':
      return new TelegramAdapter();
    default:
      throw new Error(`Unknown platform type: ${type}`);
  }
}
