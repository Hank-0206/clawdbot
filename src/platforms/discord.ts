import axios from 'axios';
import crypto from 'crypto';
import { BasePlatformAdapter } from './base.js';
import { Message, PlatformType } from '../types/index.js';

/**
 * Discord Platform Adapter
 * Supports receiving and sending messages via Discord Bot API
 */
export class DiscordAdapter extends BasePlatformAdapter {
  name = 'Discord';
  type: PlatformType = 'discord';

  private botToken: string = '';
  private publicKey: string = '';

  async initialize(config: Record<string, any>): Promise<void> {
    this.botToken = config.botToken || process.env.DISCORD_BOT_TOKEN || '';
    this.publicKey = config.publicKey || process.env.DISCORD_PUBLIC_KEY || '';

    if (!this.botToken) {
      throw new Error('Discord botToken is required');
    }
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[Discord] Adapter started`);
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log(`[Discord] Adapter stopped`);
  }

  async sendMessage(to: string, content: string): Promise<void> {
    try {
      // to can be channel ID
      await axios.post(
        `https://discord.com/api/v10/channels/${to}/messages`,
        {
          content: content,
        },
        {
          headers: {
            'Authorization': `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`[Discord] Message sent to channel ${to}`);
    } catch (error) {
      console.error(`[Discord] Failed to send message:`, error);
      throw error;
    }
  }

  /**
   * Process incoming interaction (button, select menu, etc.)
   */
  processInteraction(body: any): Message | null {
    try {
      // Interaction ping
      if (body.type === 1) {
        return {
          id: this.generateId(),
          platform: this.type,
          sender: 'system',
          content: 'ping',
          timestamp: Date.now(),
          metadata: { type: 'interaction', interactionType: body.type },
        };
      }

      // Message components (buttons, selects)
      if (body.type === 3 || body.type === 5) {
        const message: Message = {
          id: body.message?.id || this.generateId(),
          platform: this.type,
          sender: body.member?.user?.id || body.user?.id || 'unknown',
          content: body.data?.custom_id || '',
          timestamp: Date.now(),
          conversationId: body.channel_id,
          metadata: body,
        };
        return message;
      }
    } catch (error) {
      console.error(`[Discord] Failed to process interaction:`, error);
    }
    return null;
  }

  /**
   * Process incoming webhook events (messages)
   */
  processWebhook(body: any): Message | null {
    try {
      // Skip bot messages
      if (body.author?.bot) return null;

      const message: Message = {
        id: body.id || this.generateId(),
        platform: this.type,
        sender: body.author?.id || 'unknown',
        content: body.content || '',
        timestamp: Date.now(),
        conversationId: body.channel_id,
        metadata: body,
      };

      return message;
    } catch (error) {
      console.error(`[Discord] Failed to process webhook:`, error);
    }
    return null;
  }

  /**
   * Verify request signature from Discord
   */
  verifySignature(
    signature: string,
    timestamp: string,
    body: string
  ): boolean {
    if (!this.publicKey) return true;

    const msg = timestamp + body;
    const hmac = crypto.createHmac('sha256', Buffer.from(this.publicKey, 'hex'));
    hmac.update(msg);
    const digest = hmac.digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(digest, 'hex')
    );
  }

  /**
   * Reply to a message
   */
  async replyToMessage(channelId: string, messageId: string, content: string): Promise<void> {
    try {
      await axios.post(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        {
          content: content,
          message_reference: {
            message_id: messageId,
          },
        },
        {
          headers: {
            'Authorization': `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error(`[Discord] Failed to reply to message:`, error);
      throw error;
    }
  }

  /**
   * Send a direct message to a user
   */
  async sendDirectMessage(userId: string, content: string): Promise<void> {
    try {
      // Create DM channel first
      const channelResponse = await axios.post(
        'https://discord.com/api/v10/users/@me/channels',
        {
          recipient_id: userId,
        },
        {
          headers: {
            'Authorization': `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const channelId = channelResponse.data.id;

      // Send message to DM channel
      await this.sendMessage(channelId, content);
    } catch (error) {
      console.error(`[Discord] Failed to send DM:`, error);
      throw error;
    }
  }
}
