export type SiteKind = 'pve' | 'pbs';

export interface Alert {
  key: string;
  level: 'warn' | 'crit';
  title: string;
  body: string;
}

export interface GuestSummary {
  id: string;
  vmid: number;
  type: 'qemu' | 'lxc';
  name: string;
  node: string;
  status: 'running' | 'stopped' | 'paused' | 'unknown';
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  uptime: number;
}

export interface TempReading {
  label: string;
  value: number;
  kind: 'cpu' | 'nvme' | 'drive' | 'other';
}

export interface NodeTemps {
  cpu?: number;
  readings: TempReading[];
}

export interface NodeSummary {
  node: string;
  status: 'online' | 'offline';
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
  loadavg?: number[];
  temps?: NodeTemps;
  power?: number;
  systemPower?: number;
  guests: GuestSummary[];
}

export interface SiteSnapshot {
  siteId: string;
  name: string;
  kind: SiteKind;
  reachable: boolean;
  error?: string;
  quorate?: boolean;
  nodes: NodeSummary[];
  updatedAt: number;
}

export interface PbsDatastore {
  store: string;
  used: number;
  avail: number;
  total: number;
  usedPct: number;
  estimatedFull?: number | null;
}

export interface PbsBackupGroup {
  store: string;
  ns?: string;
  backupType: string;
  backupId: string;
  lastBackup: number;
  count: number;
}

export interface PbsTaskStatus {
  status: 'ok' | 'failed' | 'running' | 'unknown';
  time?: number;
}

export interface PbsSnapshot {
  siteId: string;
  name: string;
  kind: 'pbs';
  reachable: boolean;
  error?: string;
  host?: { cpu: number; mem: number; maxmem: number; uptime: number };
  temps?: NodeTemps;
  power?: number;
  systemPower?: number;
  datastores: PbsDatastore[];
  groups: PbsBackupGroup[];
  gc?: PbsTaskStatus;
  verify?: PbsTaskStatus;
  updatedAt: number;
}

export interface SitePublic {
  id: number;
  name: string;
  kind: SiteKind;
  baseUrl: string;
  tokenId: string;
  tlsVerify: boolean;
  sshHost: string | null;
  sshUser: string | null;
  sshPort: number | null;
  hasSshKey: boolean;
  enabled: boolean;
}
