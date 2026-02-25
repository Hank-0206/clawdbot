import axios from 'axios';
import { BasePlatformAdapter } from './base.js';
import { Message, PlatformType } from '../types/index.js';

/**
 * Slack Platform Adapter
 * Supports receiving and sending messages via Slack Bot API
 */
export class SlackAdapter extends BasePlatformAdapter {
  name = 'Slack';
  type: PlatformType = 'slack';

  private botToken: string = '';
  private signingSecret: string = '';

  async initialize(config: Record<string, any>): Promise<void> {
    this.botToken = config.botToken || process.env.SLACK_BOT_TOKEN || '';
    this.signingSecret = config.signingSecret || process.env.SLACK_SIGNING_SECRET || '';

    if (!this.botToken) {
      throw new Error('Slack botToken is required');
    }
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[Slack] Adapter started`);
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log(`[Slack] Adapter stopped`);
  }

  async sendMessage(to: string, content: string): Promise<void> {
    try {
      // to can be channel ID or user ID
      await axios.post(
        'https://slack.com/api/chat.postMessage',
        {
          channel: to,
          text: content,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`[Slack] Message sent to ${to}`);
    } catch (error) {
      console.error(`[Slack] Failed to send message:`, error);
      throw error;
    }
  }

  processWebhook(body: any): Message | null {
    try {
      // URL verification challenge
      if (body.type === 'url_verification') {
        return {
          id: this.generateId(),
          platform: this.type,
          sender: 'system',
          content: body.challenge || '',
          timestamp: Date.now(),
          metadata: { type: 'url_verification', challenge: body.challenge },
        };
      }

      // Event callback
      if (body.type === 'event_callback') {
        const event = body.event;
        if (event && (event.type === 'message' || event.type === 'app_mention')) {
          // Skip bot messages to avoid loops
          if (event.bot_id) return null;

          const message: Message = {
            id: event.ts || this.generateId(),
            platform: this.type,
            sender: event.user || event.bot_id || 'unknown',
            content: event.text || '',
            timestamp: parseFloat(event.ts) * 1000,
            conversationId: event.channel,
            metadata: body,
          };

          return message;
        }
      }
    } catch (error) {
      console.error(`[Slack] Failed to process webhook:`, error);
    }
    return null;
  }

  /**
   * Reply to a thread
   */
  async replyToThread(channel: string, threadTs: string, content: string): Promise<void> {
    try {
      await axios.post(
        'https://slack.com/api/chat.postMessage',
        {
          channel: channel,
          text: content,
          thread_ts: threadTs,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error(`[Slack] Failed to reply to thread:`, error);
      throw error;
    }
  }
}
