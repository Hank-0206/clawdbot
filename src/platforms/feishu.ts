import axios from 'axios';
import crypto from 'crypto';
import { BasePlatformAdapter } from './base.js';
import { Message, PlatformType } from '../types/index.js';

/**
 * Feishu (飞书) Platform Adapter
 * Supports receiving and sending messages via Feishu/Lark open platform
 */
export class FeishuAdapter extends BasePlatformAdapter {
  name = 'Feishu';
  type: PlatformType = 'feishu';

  private appId: string = '';
  private appSecret: string = '';
  private verificationToken: string = '';
  private tenantAccessToken: string = '';
  private tokenExpireTime: number = 0;

  async initialize(config: Record<string, any>): Promise<void> {
    this.appId = config.appId || process.env.FEISHU_APP_ID || '';
    this.appSecret = config.appSecret || process.env.FEISHU_APP_SECRET || '';
    this.verificationToken = config.verificationToken || process.env.FEISHU_VERIFICATION_TOKEN || '';

    if (!this.appId || !this.appSecret) {
      throw new Error('Feishu appId and appSecret are required');
    }
  }

  async start(): Promise<void> {
    await this.refreshTenantToken();
    this.running = true;
    console.log(`[Feishu] Adapter started`);
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log(`[Feishu] Adapter stopped`);
  }

  async sendMessage(to: string, content: string): Promise<void> {
    try {
      const token = await this.getTenantToken();

      // Send message using Feishu API
      await axios.post(
        'https://open.feishu.cn/open-apis/im/v1/messages',
        {
          receive_id_type: 'open_id',
          receive_id: to,
          msg_type: 'text',
          content: JSON.stringify({ text: content }),
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`[Feishu] Message sent to ${to}`);
    } catch (error) {
      console.error(`[Feishu] Failed to send message:`, error);
      throw error;
    }
  }

  /**
   * Process incoming webhook events from Feishu
   */
  processWebhook(body: any): Message | null {
    try {
      // Verify challenge for URL verification
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

      // Process callback events
      if (body.type === 'event_callback' && body.event) {
        const event = body.event;
        let content = '';
        let sender = '';

        if (event.message) {
          content = event.message.message_id || '';
          sender = event.sender?.sender_id?.open_id || event.sender?.user_id || 'unknown';
        }

        const message: Message = {
          id: event.message?.message_id || this.generateId(),
          platform: this.type,
          sender: sender,
          content: event.message?.element?.text || event.message?.text || '',
          timestamp: (event.message?.create_time || Date.now()) as number,
          conversationId: event.message?.conversation_id || event.chat?.chat_id,
          metadata: body,
        };

        return message;
      }
    } catch (error) {
      console.error(`[Feishu] Failed to process webhook:`, error);
    }
    return null;
  }

  /**
   * Reply to a message
   */
  async replyMessage(replyId: string, content: string): Promise<void> {
    try {
      const token = await this.getTenantToken();

      await axios.post(
        'https://open.feishu.cn/open-apis/im/v1/messages',
        {
          receive_id_type: 'reply_id',
          receive_id: replyId,
          msg_type: 'text',
          content: JSON.stringify({ text: content }),
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error(`[Feishu] Failed to reply message:`, error);
      throw error;
    }
  }

  private async refreshTenantToken(): Promise<void> {
    try {
      const response = await axios.post(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          app_id: this.appId,
          app_secret: this.appSecret,
        }
      );

      if (response.data.code === 0) {
        this.tenantAccessToken = response.data.tenant_access_token;
        this.tokenExpireTime = Date.now() + (response.data.expire - 60) * 1000;
      } else {
        throw new Error(`Failed to get tenant token: ${response.data.msg}`);
      }
    } catch (error) {
      console.error(`[Feishu] Failed to refresh token:`, error);
      throw error;
    }
  }

  private async getTenantToken(): Promise<string> {
    if (!this.tenantAccessToken || Date.now() > this.tokenExpireTime) {
      await this.refreshTenantToken();
    }
    return this.tenantAccessToken;
  }
}
