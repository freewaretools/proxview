import { create } from 'zustand';
import { api } from '../lib/api';
import type { Alert, PbsSnapshot, SiteSnapshot } from '../types';

interface LiveState {
  demo: boolean;
  loaded: boolean;
  connected: boolean;
  sites: Record<string, SiteSnapshot>;
  pbs: Record<string, PbsSnapshot>;
  alerts: Alert[];
  init: () => Promise<void>;
  teardown: () => void;
}

let es: EventSource | null = null;

export const useLive = create<LiveState>((set, get) => ({
  demo: false,
  loaded: false,
  connected: false,
  sites: {},
  pbs: {},
  alerts: [],

  async init() {
    // Seed with a snapshot of current state, then stream live updates.
    try {
      const data = await api.get<{
        demo: boolean;
        sites: SiteSnapshot[];
        pbs: PbsSnapshot[];
        alerts: Alert[];
      }>('/api/overview');
      const sites: Record<string, SiteSnapshot> = {};
      for (const s of data.sites) sites[s.siteId] = s;
      const pbs: Record<string, PbsSnapshot> = {};
      for (const s of data.pbs ?? []) pbs[s.siteId] = s;
      set({ demo: data.demo, sites, pbs, alerts: data.alerts ?? [], loaded: true });
    } catch {
      set({ loaded: true });
    }

    if (es) return;
    es = new EventSource('/api/stream');
    es.addEventListener('open', () => set({ connected: true }));
    es.addEventListener('error', () => set({ connected: false }));
    es.addEventListener('snapshot', (ev) => {
      try {
        const snap = JSON.parse((ev as MessageEvent).data) as SiteSnapshot;
        set({ sites: { ...get().sites, [snap.siteId]: snap }, connected: true });
      } catch {
        /* ignore malformed frame */
      }
    });
    es.addEventListener('pbs', (ev) => {
      try {
        const snap = JSON.parse((ev as MessageEvent).data) as PbsSnapshot;
        set({ pbs: { ...get().pbs, [snap.siteId]: snap }, connected: true });
      } catch {
        /* ignore malformed frame */
      }
    });
    es.addEventListener('alerts', (ev) => {
      try {
        set({ alerts: JSON.parse((ev as MessageEvent).data) as Alert[], connected: true });
      } catch {
        /* ignore malformed frame */
      }
    });
  },

  teardown() {
    es?.close();
    es = null;
    set({ connected: false });
  },
}));
