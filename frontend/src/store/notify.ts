import { create } from 'zustand';
import { api } from '../lib/api';

export type ChannelType = 'email' | 'telegram' | 'slack' | 'webpush';
export type NotifyLevel = 'info' | 'warn' | 'crit';

export interface ChannelPublic {
  id: number;
  type: ChannelType;
  name: string;
  enabled: boolean;
  minLevel: NotifyLevel;
  summary: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

interface NotifyState {
  channels: ChannelPublic[];
  loaded: boolean;
  load: () => Promise<void>;
  test: (type: ChannelType, config: Record<string, unknown>) => Promise<TestResult>;
  create: (
    type: ChannelType,
    name: string,
    config: Record<string, unknown>,
  ) => Promise<{ channel: ChannelPublic; test: TestResult }>;
  toggle: (id: number, enabled: boolean) => Promise<void>;
  setMinLevel: (id: number, minLevel: NotifyLevel) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useNotify = create<NotifyState>((set, get) => ({
  channels: [],
  loaded: false,

  async load() {
    const data = await api.get<{ channels: ChannelPublic[] }>('/api/channels');
    set({ channels: data.channels, loaded: true });
  },

  test(type, config) {
    return api.post<TestResult>('/api/channels/test', { type, config });
  },

  async create(type, name, config) {
    const res = await api.post<{ channel: ChannelPublic; test: TestResult }>('/api/channels', {
      type,
      name,
      config,
    });
    set({ channels: [...get().channels, res.channel] });
    return res;
  },

  async toggle(id, enabled) {
    const res = await api.put<{ channel: ChannelPublic }>(`/api/channels/${id}`, { enabled });
    set({ channels: get().channels.map((c) => (c.id === id ? res.channel : c)) });
  },

  async setMinLevel(id, minLevel) {
    const res = await api.put<{ channel: ChannelPublic }>(`/api/channels/${id}`, { minLevel });
    set({ channels: get().channels.map((c) => (c.id === id ? res.channel : c)) });
  },

  async remove(id) {
    await api.del(`/api/channels/${id}`);
    set({ channels: get().channels.filter((c) => c.id !== id) });
  },
}));
