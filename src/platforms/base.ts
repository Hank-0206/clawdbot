import { PlatformAdapter, Message, PlatformType, SendMessageOptions } from '../types/index.js';

// Base class for all platform adapters
export abstract class BasePlatformAdapter implements PlatformAdapter {
  abstract name: string;
  abstract type: PlatformType;
  protected config: Record<string, any> = {};
  protected messageHandler?: (message: Message) => void;
  protected running = false;

  abstract initialize(config: Record<string, any>): Promise<void>;
  abstract sendMessage(to: string, content: string, options?: SendMessageOptions): Promise<void>;
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  onMessage(handler: (message: Message) => void): void {
    this.messageHandler = handler;
  }

  protected emitMessage(message: Message): void {
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  protected generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  isRunning(): boolean {
    return this.running;
  }
}
