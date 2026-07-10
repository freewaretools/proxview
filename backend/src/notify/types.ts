export type ChannelType = 'email' | 'telegram' | 'slack' | 'webpush';

export type NotifyLevel = 'info' | 'warn' | 'crit';

export interface NotifyMessage {
  title: string;
  body: string;
  level: NotifyLevel;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface SlackConfig {
  webhookUrl: string;
}
