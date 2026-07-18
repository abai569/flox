import type { NodeRenewalCycle } from "./renewal";
import type { NodeSystemInfo } from "./system-info";

export interface NodeExpiryInstance {
  nodeId: number;
  instanceId: string;
  displayIndex?: number;
  displayName?: string;
  expiryTime: number;
  renewalCycle: NodeRenewalCycle;
  expiryReminderDismissed?: number;
  expiryReminderDismissedUntil?: number | null;
}

export interface Node {
  id: number;
  inx?: number;
  name: string;
  remark?: string;
  expiryTime?: number;
  renewalCycle?: NodeRenewalCycle;
  flowResetTime?: number;
  expiryReminderDismissed?: number;
  expiryReminderDismissedUntil: number | null;
  expiryInstances?: NodeExpiryInstance[];
  ip: string;
  serverIp: string;
  intranetIp?: string;
  serverIpV4?: string;
  serverIpV6?: string;
  port: string;
  tcpListenAddr?: string;
  udpListenAddr?: string;
  extraIPs?: string;
  remoteConfig?: string;
  remoteUrl?: string;
  remoteInstances?: Array<{
    instanceId: string;
    displayName?: string;
    displayIndex?: number;
    status?: number;
    weight?: number;
    selected: boolean;
    inScope: boolean;
  }>;
  syncError?: string;
  isRemote?: number;
  version?: string;
  http?: number;
  tls?: number;
  socks?: number;
  status: number;
  connectionStatus: "online" | "offline";
  paused?: number;
  mimicStatus?: string;
  mimicError?: string;
  systemInfo?: NodeSystemInfo | null;
  copyLoading?: boolean;
  upgradeLoading?: boolean;
  rollbackLoading?: boolean;
  groupId?: number | null;
  secret?: string;
  onlineCount?: number;
  trafficRatio?: number;
  trafficLimit?: number;
  remoteCurrentFlow?: number;
  remoteInFlow?: number;
  remoteOutFlow?: number;
  remoteMaxBandwidth?: number;
  remoteExpiryTime?: number;
  periodTraffic?: {
    rx: number;
    tx: number;
    since: number;
    nextReset?: number;
    cycle?: string;
  };
}
