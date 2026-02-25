import axios from 'axios';
import crypto from 'crypto';
import { BasePlatformAdapter } from './base.js';
import { Message, PlatformType } from '../types/index.js';

/**
 * WeChat Work (企业微信) Platform Adapter
 * Supports receiving and sending messages via WeChat Work robots and APIs
 */
export class WeChatWorkAdapter extends BasePlatformAdapter {
  name = 'WeChat Work';
  type: PlatformType = 'wechat-work';

  private corpId: string = '';
  private corpSecret: string = '';
  private agentId: string = '';
  private token: string = '';
  private tokenExpireTime: number = 0;
  private encodingAESKey: string = '';

  async initialize(config: Record<string, any>): Promise<void> {
    this.corpId = config.corpId || process.env.WECHAT_WORK_CORP_ID || '';
    this.corpSecret = config.corpSecret || process.env.WECHAT_WORK_CORP_SECRET || '';
    this.agentId = config.agentId || process.env.WECHAT_WORK_AGENT_ID || '';
    this.encodingAESKey = config.encodingAESKey || process.env.WECHAT_WORK_ENCODING_AES_KEY || '';

    if (!this.corpId || !this.corpSecret) {
      throw new Error('WeChat Work corpId and corpSecret are required');
    }
  }

  async start(): Promise<void> {
    await this.refreshToken();
    this.running = true;
    console.log(`[WeChat Work] Adapter started`);
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log(`[WeChat Work] Adapter stopped`);
  }

  async sendMessage(to: string, content: string): Promise<void> {
    try {
      const token = await this.getToken();

      await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
        {
          touser: to,
          msgtype: 'text',
          agentid: this.agentId,
          text: {
            content: content,
          },
        },
        {
          params: {
            access_token: token,
          },
        }
      );

      console.log(`[WeChat Work] Message sent to ${to}`);
    } catch (error) {
      console.error(`[WeChat Work] Failed to send message:`, error);
      throw error;
    }
  }

  /**
   * Process incoming webhook events from WeChat Work
   */
  processWebhook(query: any, body: any): Message | null {
    try {
      const msgSignature = query.msg_signature || '';
      const timestamp = query.timestamp || '';
      const nonce = query.nonce || '';

      // Handle verification URL
      if (query.echostr) {
        const decrypted = this.decryptEchoStr(query.echostr);
        return {
          id: this.generateId(),
          platform: this.type,
          sender: 'system',
          content: decrypted || '',
          timestamp: Date.now(),
          metadata: { type: 'url_verification', echostr: query.echostr },
        };
      }

      // Process messages (need to decrypt if encrypted)
      let messageContent = body.xml?.content || body.content || '';
      let fromUser = body.xml?.fromusername || body.fromUserName || 'unknown';

      // If encrypted message, decrypt it
      if (body.xml?.encrypt) {
        const decrypted = this.decryptMessage(body.xml.encrypt);
        if (decrypted) {
          messageContent = decrypted.content || '';
          fromUser = decrypted.fromUsername || fromUser;
        }
      }

      const message: Message = {
        id: body.xml?.msgid || this.generateId(),
        platform: this.type,
        sender: fromUser,
        content: messageContent,
        timestamp: parseInt(body.xml?.createtime || Date.now().toString()),
        conversationId: body.xml?.agentid || this.agentId,
        metadata: body,
      };

      return message;
    } catch (error) {
      console.error(`[WeChat Work] Failed to process webhook:`, error);
    }
    return null;
  }

  /**
   * Verify webhook signature
   */
  verifySignature(signature: string, timestamp: string, nonce: string, echostr: string): boolean {
    const list = [this.encodingAESKey, timestamp, nonce, echostr].sort();
    const str = list.join('');
    const sha1 = crypto.createHash('sha1');
    sha1.update(str);
    const calculatedSignature = sha1.digest('hex');
    return calculatedSignature === signature;
  }

  private async refreshToken(): Promise<void> {
    try {
      const response = await axios.get(
        'https://qyapi.weixin.qq.com/cgi-bin/gettoken',
        {
          params: {
            corpid: this.corpId,
            corpsecret: this.corpSecret,
          },
        }
      );

      if (response.data.errcode === 0) {
        this.token = response.data.access_token;
        this.tokenExpireTime = Date.now() + (response.data.expires_in - 60) * 1000;
      } else {
        throw new Error(`Failed to get token: ${response.data.errmsg}`);
      }
    } catch (error) {
      console.error(`[WeChat Work] Failed to refresh token:`, error);
      throw error;
    }
  }

  private async getToken(): Promise<string> {
    if (!this.token || Date.now() > this.tokenExpireTime) {
      await this.refreshToken();
    }
    return this.token;
  }

  private decryptEchoStr(echoStr: string): string {
    if (!this.encodingAESKey) return echoStr;

    try {
      const aesKey = Buffer.from(this.encodingAESKey + '=', 'base64');
      const encrypted = Buffer.from(echoStr, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.slice(0, 16));
      decipher.setAutoPadding(true);

      let decrypted = decipher.update(encrypted, undefined, 'utf8') as string;
      decrypted += decipher.final('utf8');

      // Remove random prefix and corpId suffix
      const idx = decrypted.indexOf('');
      if (idx > 0) {
        const len = parseInt(decrypted.substring(0, 4), 16);
        return decrypted.substring(4, 4 + len);
      }
      return decrypted;
    } catch (error) {
      console.error(`[WeChat Work] Failed to decrypt echo string:`, error);
      return echoStr;
    }
  }

  private decryptMessage(encrypt: string): { content?: string; fromUsername?: string } | null {
    if (!this.encodingAESKey) {
      return { content: encrypt };
    }

    try {
      const aesKey = Buffer.from(this.encodingAESKey + '=', 'base64');
      const encrypted = Buffer.from(encrypt, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, aesKey.slice(0, 16));
      decipher.setAutoPadding(true);

      let decrypted = decipher.update(encrypted, undefined, 'utf8') as string;
      decrypted += decipher.final('utf8');

      // Parse XML format
      const contentMatch = decrypted.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/);
      const fromMatch = decrypted.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/);

      return {
        content: contentMatch ? contentMatch[1] : decrypted,
        fromUsername: fromMatch ? fromMatch[1] : undefined,
      };
    } catch (error) {
      console.error(`[WeChat Work] Failed to decrypt message:`, error);
      return null;
    }
  }
}
