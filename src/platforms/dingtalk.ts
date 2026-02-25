import axios from 'axios';
import crypto from 'crypto';
import { BasePlatformAdapter } from './base.js';
import { Message, PlatformType } from '../types/index.js';

/**
 * DingTalk Platform Adapter
 * Supports receiving and sending messages via DingTalk robots
 */
export class DingTalkAdapter extends BasePlatformAdapter {
  name = 'DingTalk';
  type: PlatformType = 'dingtalk';

  private webhook: string = '';
  private secret: string = '';
  private token: string = '';

  async initialize(config: Record<string, any>): Promise<void> {
    this.webhook = config.webhook || '';
    this.secret = config.secret || '';
    this.token = config.token || '';

    if (!this.webhook && !this.token) {
      throw new Error('DingTalk webhook or token is required');
    }
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[DingTalk] Adapter started`);
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log(`[DingTalk] Adapter stopped`);
  }

  async sendMessage(to: string, content: string): Promise<void> {
    try {
      const timestamp = Date.now();
      const sign = await this.generateSign(timestamp);

      const url = `${this.webhook}&timestamp=${timestamp}&sign=${sign}`;

      await axios.post(url, {
        msgtype: 'text',
        text: {
          content: content,
        },
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log(`[DingTalk] Message sent to ${to}`);
    } catch (error) {
      console.error(`[DingTalk] Failed to send message:`, error);
      throw error;
    }
  }

  /**
   * Process incoming webhook events from DingTalk
   */
  processWebhook(body: any): Message | null {
    try {
      if (body.msgtype === 'text' || body.event === 'callback') {
        const message: Message = {
          id: this.generateId(),
          platform: this.type,
          sender: body.sender || body.userId || 'unknown',
          content: body.text?.content || body.content || '',
          timestamp: Date.now(),
          conversationId: body.conversationId || body.chatid,
          metadata: body,
        };
        return message;
      }
    } catch (error) {
      console.error(`[DingTalk] Failed to process webhook:`, error);
    }
    return null;
  }

  private async generateSign(timestamp: number): Promise<string> {
    if (!this.secret) return '';

    const stringToSign = `${timestamp}\n${this.secret}`;
    const hmac = crypto.createHmac('sha256', this.secret);
    hmac.update(stringToSign);
    const sign = hmac.digest('base64');
    return encodeURIComponent(sign);
  }
}
