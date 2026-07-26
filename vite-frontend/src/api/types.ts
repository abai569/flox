export interface NodeApiItem {
  id: number;
  name: string;
  status: number;
  inx?: number;
  remark?: string;
  expiryTime?: number;
  renewalCycle?: "month" | "quarter" | "halfYear" | "" | "year";
  expiryReminderDismissed?: number;
  expiryReminderDismissedUntil?: number | null;
  flowResetTime?: number;
  trafficLimit?: number;
  totalInFlow?: number;
  totalOutFlow?: number;
  expiryInstances?: NodeExpiryInstanceApiItem[];
  weight?: number;
  trafficRatio?: number;
  onlineCount?: number;
  isRemote?: number;
  remoteUrl?: string;
  remoteConfig?: string;
  remoteInstances?: PeerShareInstanceApiItem[];
  syncError?: string;
  remoteCurrentFlow?: number;
  remoteInFlow?: number;
  remoteOutFlow?: number;
  remoteMaxBandwidth?: number;
  remoteExpiryTime?: number;
  // 周期流量统计
  periodTraffic?: {
    rx: number;
    tx: number;
    since: number;
    nextReset?: number;
    cycle?: string;
  };
  [key: string]: unknown;
}

export interface NodeExpiryInstanceApiItem {
  nodeId: number;
  instanceId: string;
  displayIndex?: number;
  displayName?: string;
  expiryTime: number;
  renewalCycle: "month" | "quarter" | "halfYear" | "" | "year";
  expiryReminderDismissed?: number;
  expiryReminderDismissedUntil?: number | null;
  flowResetTime?: number;
  trafficLimit?: number;
}

export interface UserApiItem {
  id: number;
  user: string;
  name?: string;
  status: number;
  flow: number;
  num: number;
  expTime?: number;
  flowResetTime?: number;
  totalInFlow?: number;
  totalOutFlow?: number;
  dailyQuotaGB?: number;
  monthlyQuotaGB?: number;
  dailyUsedBytes?: number;
  monthlyUsedBytes?: number;
  disabledByQuota?: number;
  quotaDisabledAt?: number;
  forwardSpeedLimit?: number | null;
  manualTunnelEnabled?: 0 | 1;
  tunnelGroupId?: number;
  [key: string]: unknown;
}

export interface UserListQuery {
  current?: number;
  size?: number;
  keyword?: string;
  [key: string]: unknown;
}

export interface TunnelApiItem {
  id: number;
  name: string;
  type: number;
  status: number;
  flow?: number;
  trafficRatio?: number;
  inIp?: string;
  ipPreference?: string;
  inNodeId?: TunnelChainNodePayload[];
  outNodeId?: TunnelChainNodePayload[];
  chainNodes?: TunnelChainNodePayload[][];
  entryNodeId: number;
  exitNodeId: number;
  inx?: number;
  listId?: number | null;
  tunnelGroupId?: number | null;
  tunnelGroupIds?: number[];
  remark?: string;
  forwardSpeedLimit?: number | null;
  [key: string]: unknown;
}

export interface ForwardApiItem {
  id: number;
  name: string;
  status: number;
  tunnelName?: string;
  tunnelTrafficRatio?: number;
  isManualTunnel?: boolean;
  inIp?: string;
  inPort?: number;
  remoteAddr?: string;
  strategy?: string;
  inFlow?: number;
  outFlow?: number;
  userId?: number;
  tunnelId?: number;
  speedId?: number | null;
  inx?: number;
  maxConnections: number;
  currentConnections?: number;
  trafficLimit?: number;
  expiryTime?: number | null;
  speedLimitEnabled?: boolean;
  mode?: string;
  speedLimit?: number;
  inSpeed?: number; // 新增：实时上行速度 (bytes/s)
  outSpeed?: number; // 新增：实时下行速度 (bytes/s)
  [key: string]: unknown;
}

export interface PeerShareUsedPortApiItem {
  runtimeId: number;
  port: number;
  role: string;
  protocol: string;
  resourceKey: string;
  applied: number;
  updatedTime: number;
  instances: PeerShareRuntimeInstanceApiItem[];
}

export interface PeerShareApiItem {
  id: number;
  name: string;
  nodeId: number;
  token: string;
  maxBandwidth: number;
  remSpeedLimit: number;
  remForwardSpeedLimit: number;
  currentFlow: number;
  trafficRatio: number;
  expiryTime: number;
  portRangeStart: number;
  portRangeEnd: number;
  isActive: number;
  allowedDomains?: string;
  allowedIps?: string;
  usedPorts: number[];
  usedPortDetails: PeerShareUsedPortApiItem[];
  activeRuntimeNum: number;
  scopeType?: "all_enabled" | "selected";
  autoIncludeNewInstances?: boolean | number;
  minHealthyInstances?: number;
  instances?: PeerShareInstanceApiItem[];
  flows?: PeerShareFlowApiItem[];
  consumerPanelUrl?: string;
}

export interface PeerShareInstanceApiItem {
  instanceId: string;
  displayName?: string;
  displayIndex?: number;
  hostname?: string;
  status?: number;
  weight?: number;
  version?: string;
  renewalCycle?: "month" | "quarter" | "halfYear" | "" | "year";
  flowResetTime?: number;
  publicIpV4?: string;
  publicIpV6?: string;
  publicIpV4Region?: string;
  publicIpV4CountryCode?: string;
  publicIpV6Region?: string;
  publicIpV6CountryCode?: string;
  onlineCount?: number;
  tcpConns?: number;
  udpConns?: number;
  periodRx?: number;
  periodTx?: number;
  totalInFlow?: number;
  totalOutFlow?: number;
  trafficLimit?: number;
  expiryTime?: number;
  selected: boolean;
  inScope: boolean;
}

export interface PeerShareRuntimeInstanceApiItem {
  runtimeId: number;
  instanceId: string;
  port: number;
  applied: number;
  healthy: number;
  status: number;
  lastError: string;
  currentFlow: number;
  updatedTime: number;
}

export interface PeerShareFlowApiItem {
  runtimeId: number;
  instanceId: string;
  periodType: string;
  periodKey: number;
  inFlow: number;
  outFlow: number;
  createdTime: number;
  updatedTime: number;
}

export interface PeerShareMutationPayload {
  id?: number;
  name: string;
  nodeId?: number;
  maxBandwidth?: number;
  remSpeedLimit?: number;
  remForwardSpeedLimit?: number;
  expiryTime?: number;
  portRangeStart?: number;
  portRangeEnd?: number;
  allowedDomains?: string;
  allowedIps?: string;
  scopeType?: "all_enabled" | "selected";
  instanceIds?: string[];
  autoIncludeNewInstances?: boolean;
  currentFlow?: number;
  trafficRatio: number;
  minHealthyInstances?: number;
  consumerPanelUrl?: string;
  consumerPanelToken?: string;
}

export interface PeerRemoteUsageBindingApiItem {
  bindingId: number;
  tunnelId: number;
  tunnelName: string;
  chainType: number;
  hopInx: number;
  allocatedPort: number;
  resourceKey: string;
  remoteBindingId: string;
  updatedTime: number;
}

export interface PeerRemoteUsageNodeApiItem {
  nodeId: number;
  nodeName: string;
  remoteUrl: string;
  shareId: number;
  portRangeStart: number;
  portRangeEnd: number;
  maxBandwidth: number;
  remSpeedLimit: number;
  remForwardSpeedLimit: number;
  trafficRatio?: number;
  currentFlow: number;
  remoteCurrentFlow?: number;
  remoteInFlow?: number;
  remoteOutFlow?: number;
  expiryTime: number;
  usedPorts: number[];
  bindings: PeerRemoteUsageBindingApiItem[];
  activeBindingNum: number;
  syncError?: string;
  instances?: PeerShareInstanceApiItem[];
  flows?: PeerShareFlowApiItem[];
  runtimeInstances?: PeerShareRuntimeInstanceApiItem[];
}

export interface UserTunnelApiItem {
  id: number;
  name: string;
  remark?: string;
  tunnelId?: number;
  tunnelName?: string;
  inNodePortSta?: number;
  inNodePortEnd?: number;
  speedId?: number | null;
  [key: string]: unknown;
}

export interface UserTunnelPermissionApiItem {
  id: number;
  userId: number;
  tunnelId: number;
  tunnelName: string;
  status: number;
  flow: number;
  num: number;
  expTime: number;
  flowResetTime: number;
  speedId?: number | null;
  speedLimitName?: string;
  ceilingSpeed?: number | null;
  forwardSpeedLimit?: number | null;
  inFlow: number;
  outFlow: number;
  tunnelFlow?: number;
  [key: string]: unknown;
}

export interface StatisticsFlowApiItem {
  id: number;
  userId: number;
  flow: number;
  totalFlow: number;
  time: string;
  [key: string]: unknown;
}

export interface SpeedLimitApiItem {
  id: number;
  name: string;
  speed: number;
  status?: number;
  createdTime: string;
  updatedTime: string;
  uploadSpeed?: number;
  downloadSpeed?: number;
  [key: string]: unknown;
}

export interface TunnelGroupApiItem {
  id: number;
  name: string;
  color?: string;
  description?: string;
  inx?: number;
  status: number;
  tunnelIds: number[];
  tunnelNames: string[];
  createdTime: number;
  updatedTime?: number;
  tunnelCount?: number;
  [key: string]: unknown;
}

export interface TunnelGroupNewApiItem {
  id: number;
  name: string;
  description: string;
  color: string;
  inx: number;
  status: number;
  createdTime: number;
  updatedTime?: number;
  tunnelCount: number;
  [key: string]: unknown;
}

export interface TunnelGroupNewMutationPayload {
  id?: number;
  name: string;
  description?: string;
  color?: string;
  inx?: number;
  status?: number;
  [key: string]: unknown;
}

// Tunnel List Grouping (display only, independent from tunnel_group)
export interface TunnelListApiItem {
  id: number;
  name: string;
  inx: number;
  status: number;
  tunnelIds: number[];
  tunnelNames: string[];
  createdTime: number;
}

export interface TunnelListOrderPayload {
  id: number;
  inx: number;
}

export interface TunnelListTunnelOrderPayload {
  tunnelId: number;
  inx: number;
}

export interface UserGroupApiItem {
  id: number;
  name: string;
  status: number;
  userIds: number[];
  userNames: string[];
  createdTime: number;
  [key: string]: unknown;
}

export interface GroupPermissionApiItem {
  id: number;
  userGroupId: number;
  userGroupName: string;
  tunnelGroupId: number;
  tunnelGroupName: string;
  createdTime: number;
  [key: string]: unknown;
}

export interface TunnelDiagnosisApiItem {
  success: boolean;
  description: string;
  nodeName: string;
  nodeId: string;
  targetIp: string;
  targetPort?: number;
  message?: string;
  averageTime?: number;
  packetLoss?: number;
  fromChainType?: number;
  fromInx?: number;
  toChainType?: number;
  toInx?: number;
  fromInstanceId?: string;
  fromInstanceDisplayName?: string;
  fromInstanceDisplayIndex?: number;
  toInstanceId?: string;
  toInstanceDisplayName?: string;
  toInstanceDisplayIndex?: number;
  [key: string]: unknown;
}

export interface TunnelDiagnosisApiData {
  tunnelName: string;
  tunnelType: string;
  timestamp: number;
  results: TunnelDiagnosisApiItem[];
}

export interface ForwardDiagnosisApiData {
  forwardName: string;
  timestamp: number;
  results: TunnelDiagnosisApiItem[];
}

export interface NodeReleaseApiItem {
  version: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  channel: "stable" | "dev";
}

export interface UserPackageInfoApiData {
  userInfo: {
    id: number;
    flow: number;
    trafficFlow: number;
    inFlow: number;
    outFlow: number;
    num: number;
    expTime?: string;
    flowResetTime?: number;
    canCreateManualTunnel?: boolean;
    [key: string]: unknown;
  };
  tunnelPermissions: UserTunnelPermissionApiItem[];
  forwards: ForwardApiItem[];
  statisticsFlows: StatisticsFlowApiItem[];
  [key: string]: unknown;
}

export interface BatchOperationResult {
  successCount: number;
  failCount: number;
  failures?: BatchOperationFailure[];
  [key: string]: unknown;
}

export interface TrafficResetBatchItem {
  nodeId?: number;
  forwardId?: number;
  instanceId?: string;
  nodeName?: string;
  forwardName?: string;
  success: boolean;
  error?: string;
}

export interface BatchOperationFailure {
  id?: number;
  name?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface TunnelDeletePreviewForwardApiItem {
  id: number;
  name: string;
  userId: number;
  userName: string;
  inPort: number;
  [key: string]: unknown;
}

export interface TunnelDeletePreviewApiData {
  tunnelId: number;
  tunnelName: string;
  forwardCount: number;
  sampleForwards: TunnelDeletePreviewForwardApiItem[];
  [key: string]: unknown;
}

export interface TunnelBatchDeletePreviewApiData {
  tunnelCount: number;
  totalForwardCount: number;
  items: TunnelDeletePreviewApiData[];
  [key: string]: unknown;
}

export interface TunnelDeleteWithForwardsApiData {
  forwardCount: number;
  migratedCount: number;
  deletedForwardCount: number;
  portAdjustedCount: number;
  warnings?: string[];
  [key: string]: unknown;
}

export interface TunnelBatchDeleteWithForwardsApiData {
  successCount: number;
  failCount: number;
  failures?: BatchOperationFailure[];
  deletedForwardCount: number;
  migratedCount: number;
  portAdjustedCount: number;
  warnings?: string[];
  [key: string]: unknown;
}

export interface UserMutationPayload {
  id?: number;
  user?: string;
  name?: string;
  password?: string;
  status?: number;
  flow?: number;
  num?: number;
  expTime?: number | string;
  flowResetTime?: number;
  dailyQuotaGB?: number;
  monthlyQuotaGB?: number;
  tunnelFlow?: number;
  roleId?: number;
  manualTunnelEnabled?: 0 | 1;
  inFlow?: number;
  outFlow?: number;
  tunnelGroupId?: number | null;
  forwardSpeedLimit?: number | null;
}

export interface NodeMutationPayload {
  id?: number | null;
  name?: string;
  status?: number;
  inx?: number;
  remark?: string;
  expiryTime?: number;
  renewalCycle?: "month" | "quarter" | "halfYear" | "" | "year";
  groupId?: number | null;
  serverIp?: string;
  intranetIp?: string;
  serverIpV4?: string;
  serverIpV6?: string;
  extraIPs?: string;
  port?: string;
  tcpListenAddr?: string;
  udpListenAddr?: string;
  interfaceName?: string;
  secret?: string;
  http?: number;
  tls?: number;
  socks?: number;
  trafficRatio?: number;
  trafficLimit?: number;
}

export interface TunnelChainNodePayload {
  nodeId: number;
  protocol?: string;
  strategy?: string;
  connectIp?: string;
  chainType?: number;
  inx?: number;
  connectIpType?: string;
}

export interface TunnelMutationPayload {
  id?: number;
  name?: string;
  type?: number;
  status?: number;
  flow?: number;
  trafficRatio?: number;
  inIp?: string;
  ipPreference?: string;
  inNodeId?: TunnelChainNodePayload[];
  outNodeId?: TunnelChainNodePayload[];
  chainNodes?: TunnelChainNodePayload[][];
  tunnelGroupId?: number | null;
  remark?: string;
  http?: number;
  tls?: number;
  socks?: number;
  blockOther?: number;
}

export interface TunnelCreateApiData {
  id: number;
}

export interface UserQuotaResetPayload {
  userId: number;
  scope?: "daily" | "monthly" | "all";
}

export interface UserTunnelAssignPayload {
  userId?: number;
  id?: number;
  tunnelId?: number;
  flow?: number;
  num?: number;
  expTime?: number;
  flowResetTime?: number;
  status?: number;
  speedId?: number | null;
  ceilingSpeed?: number | null;
  forwardSpeedLimit?: number | null;
  tunnels?: Array<{ tunnelId: number; speedId?: number | null; ceilingSpeed?: number | null; forwardSpeedLimit?: number | null }>;
}

export interface UserTunnelListQuery {
  userId?: number;
  tunnelId?: number;
  current?: number;
  size?: number;
}

export interface UserTunnelRemovePayload {
  id?: number;
  userId?: number;
  tunnelId?: number;
}

export interface ForwardMutationPayload {
  id?: number;
  name?: string;
  status?: number;
  tunnelId?: number | null;
  inIp?: string;
  inPort?: number | null;
  remoteAddr?: string;
  strategy?: string;
  speedId?: number | null;
  speedLimitEnabled?: boolean;
  speedLimit?: number;
  maxConnections?: number;
  mode?: string;
}

export interface SpeedLimitMutationPayload {
  id?: number;
  name?: string;
  speed?: number;
  status?: number;
}

export interface UpdatePasswordPayload {
  currentPassword: string;
  newPassword: string;
  newUsername?: string;
}

export interface BackupImportPayload {
  types: string[];
  [key: string]: unknown;
}

export interface NodeMetricApiItem {
  id: number;
  nodeId: number;
  instanceId?: string;
  timestamp: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  netInBytes: number;
  netOutBytes: number;
  netInSpeed: number;
  netOutSpeed: number;
  load1: number;
  load5: number;
  load15: number;
  tcpConns: number;
  udpConns: number;
  uptime: number;
}

export interface TunnelMetricApiItem {
  id: number;
  tunnelId: number;
  nodeId: number;
  timestamp: number;
  bytesIn: number;
  bytesOut: number;
  connections: number;
  errors: number;
  avgLatencyMs: number;
}

export interface ServiceMonitorApiItem {
  id: number;
  name: string;
  // Keep as string for forward-compatibility.
  type: string;
  target: string;
  intervalSec: number;
  timeoutSec: number;
  nodeId: number;
  enabled: number;
  createdTime: number;
  updatedTime: number;
}

export interface ServiceMonitorResultApiItem {
  id: number;
  monitorId: number;
  timestamp: number;
  success: number;
  latencyMs: number;
  statusCode: number;
  errorMessage: string;
}

export interface ServiceMonitorMutationPayload {
  id?: number;
  name: string;
  type: "tcp" | "icmp";
  target: string;
  intervalSec?: number;
  timeoutSec?: number;
  nodeId?: number;
  enabled?: number;
}

export interface ServiceMonitorLimitsApiData {
  checkerScanIntervalSec: number;
  minIntervalSec: number;
  defaultIntervalSec: number;
  minTimeoutSec: number;
  defaultTimeoutSec: number;
  maxTimeoutSec: number;
}

export interface MonitorNodeApiItem {
  id: number;
  inx: number;
  name: string;
  status: number;
  isRemote?: number;
  version?: string;
  weight?: number;
  instanceCount?: number;
  onlineInstanceCount?: number;
  updatedTime: number;
}

export interface MonitorNodeInstanceGroupMemberApiItem {
  nodeId: number;
  nodeName: string;
  instanceId?: string;
  displayIndex?: number;
  displayName?: string;
  remark?: string;
  hostname?: string;
  publicIpV4?: string;
  publicIpV6?: string;
  publicIpV4Region?: string;
  publicIpV4CountryCode?: string;
  publicIpV6Region?: string;
  publicIpV6CountryCode?: string;
  status: number;
  weight: number;
  portRange?: string;
  expiryTime?: number;
  renewalCycle?: "month" | "quarter" | "halfYear" | "" | "year";
  expiryReminderDismissed?: number;
  expiryReminderDismissedUntil?: number | null;
  flowResetTime?: number;
  trafficLimit?: number;
  trafficLimitMode?: number;
  totalInFlow?: number;
  totalOutFlow?: number;
  onlineCount: number;
  tcpConns?: number;
  udpConns?: number;
  netInSpeed: number;
  netOutSpeed: number;
  netInBytes: number;
  netOutBytes: number;
  periodNetInBytes: number;
  periodNetOutBytes: number;
  uptime: number;
  periodRx: number;
  periodTx: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
}

export interface MonitorNodeInstanceGroupApiItem {
  id: number;
  name: string;
  status: number;
  totalInSpeed: number;
  totalOutSpeed: number;
  members: MonitorNodeInstanceGroupMemberApiItem[];
}

export interface MonitorPublicNodeInstanceGroupMemberApiItem {
  nodeId: number;
  nodeName: string;
  instanceId?: string;
  displayIndex: number;
  displayName?: string;
  publicIpV4Region?: string;
  publicIpV4CountryCode?: string;
  publicIpV6Region?: string;
  publicIpV6CountryCode?: string;
  status: number;
  onlineCount: number;
  tcpConns?: number;
  udpConns?: number;
  netInSpeed: number;
  netOutSpeed: number;
  netInBytes: number;
  netOutBytes: number;
  periodNetInBytes: number;
  periodNetOutBytes: number;
  uptime: number;
  periodRx: number;
  periodTx: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
}

export interface MonitorPublicNodeInstanceGroupApiItem {
  id: number;
  name: string;
  status: number;
  totalInSpeed: number;
  totalOutSpeed: number;
  members: MonitorPublicNodeInstanceGroupMemberApiItem[];
}

export interface NodeInstancePortApiItem {
  id: number;
  nodeId: number;
  instanceId: string;
  displayIndex?: number;
  displayName?: string;
  hostname?: string;
  publicIpV4?: string;
  publicIpV6?: string;
  status: number;
  weight: number;
  portRange?: string;
}

export interface NodeInstancePortApiData {
  nodeId: number;
  nodeName: string;
  nodePortRange: string;
  instances: NodeInstancePortApiItem[];
}

export interface NodeInstanceOrderUpdatePayload {
  nodeId: number;
  instanceIds: string[];
}

export interface MonitorNodeMetricsApiItem extends MonitorNodeApiItem {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  netInSpeed: number;
  netOutSpeed: number;
  netInBytes: number;
  netOutBytes: number;
  uptime: number;
  tcpConns: number;
  load1: number;
}

export interface MonitorTunnelApiItem {
  id: number;
  inx: number;
  name: string;
  status: number;
  updatedTime: number;
}

export interface MonitorPermissionApiItem {
  id: number;
  userId: number;
  fullAccess: number;
  createdTime: number;
}

export interface MonitorAccessApiData {
  allowed: boolean;
  fullAccess?: boolean;
  reason?: string;
}

export interface TunnelQualityApiItem {
  tunnelId: number;
  entryToExitLatency: number;
  exitToBingLatency: number;
  entryToExitLoss: number;
  exitToBingLoss: number;
  success: boolean;
  errorMessage?: string;
  timestamp: number;
}

export interface NodeGroupApiItem {
  id: number;
  name: string;
  description: string;
  color: string;
  inx: number;
  createdTime: number;
  updatedTime?: number;
  nodeCount: number;
}

export interface NodeGroupMutationPayload {
  id?: number;
  name: string;
  description?: string;
  color?: string;
  inx?: number;
}

export interface PackageGroupApiItem {
  id: number;
  name: string;
  description: string;
  color: string;
  inx: number;
  createdTime: number;
  updatedTime?: number;
  packageCount: number;
}

export interface PackageGroupMutationPayload {
  id?: number;
  name: string;
  description?: string;
  color?: string;
  inx?: number;
}

export interface NodeTagApiItem {
  id: number;
  name: string;
  color: string;
  createdTime: number;
  nodeCount: number;
}

export interface NodeTagMutationPayload {
  id?: number;
  name: string;
  color?: string;
}

export interface OfflineDeployPayload {
  panelAddr: string;
  secret: string;
  nodeName: string;
  amd64Download: string;
  arm64Download: string;
}

// 用户流量历史项
export interface UserQuotaHistoryItem {
  id: number;
  periodType: "daily" | "monthly" | "tunnel" | "user-adjust";
  periodKey: number;
  usedBytes: number;
  inFlowBefore: number;
  outFlowBefore: number;
  inFlowAfter: number;
  outFlowAfter: number;
  inFlowGB: string;
  outFlowGB: string;
  usedGB: string;
  actionType: "reset" | "adjust" | "auto_reset";
  operatorId: number;
  operatorName: string;
  resetTime: number;
  createdTime: number;
  resetReason?: string;
}

export interface PeerShareTrafficResetLogApiItem {
  id: number;
  shareId: number;
  shareName: string;
  nodeId: number;
  nodeName: string;
  inFlowBefore: number;
  outFlowBefore: number;
  currentBefore: number;
  trafficRatio: number;
  chargedBefore: number;
  resetTime: number;
  operatorId: number;
  operatorName: string;
  reason: string;
  createdTime: number;
}

// 续费记录
export interface UserRenewalLogItem {
  id: number;
  userId: number;
  userName: string;
  renewalAmount: number;
  balanceBefore: number;
  balanceAfter: number;
  expTimeBefore: number;
  expTimeAfter: number;
  renewalTime: number;
  operatorName: string;
  reason: string;
}

// 购流记录
export interface UserTrafficBuyLogItem {
  id: number;
  userId: number;
  userName: string;
  buyAmount: number;
  buyPrice: number;
  balanceBefore: number;
  balanceAfter: number;
  flowBefore: number;
  flowAfter: number;
  buyTime: number;
  reason: string;
}

export interface TrafficHistoryItem {
  id: number;
  userId: number;
  userName: string;
  periodKey: number; // YYYYMM
  inFlow: number;
  outFlow: number;
  usedBytes: number;
  createdTime: number;
}

export interface SystemUpgradeCapabilityApiData {
  capable: boolean;
  reasons: string[];
  deployDir: string;
  backendContainer: string;
}

export interface SystemUpgradeReleaseApiItem {
  version: string;
  name: string;
  publishedAt: string;
  prerelease: boolean;
  channel: "stable" | "dev";
}

export interface SystemUpgradeVersionApiData {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  channel: "stable" | "dev";
  reason?: string;
  capability: SystemUpgradeCapabilityApiData;
}

export interface SystemUpgradeCheckApiData extends SystemUpgradeVersionApiData {
  releases: SystemUpgradeReleaseApiItem[];
}

export interface SystemUpgradeRunApiData {
  version: string;
  channel: "stable" | "dev";
  composeAsset: string;
  helperContainer: string;
  backendImageId: string;
  message: string;
}

export interface SystemUpgradeStatusApiData {
  state:
    | ""
    | "running"
    | "success"
    | "backup_failed"
    | "rollback_running"
    | "rolled_back"
    | "rollback_failed";
  fromVersion?: string;
  toVersion?: string;
  stage?: string;
  message?: string;
  backupDir?: string;
  updatedAt?: number;
}

// ─── Payment & Shop ──────────────────────────────────────────────────

export interface OrderApiItem {
  id: number;
  orderNo: string;
  userId: number;
  userName: string;
  productId: number;
  productName: string;
  productType: string;
  amount: number;
  payCurrency: "BALANCE" | "USDT" | "YIPAY";
  payType?: string;
  status: number;
  payTime: number;
  payUrl: string;
  payAddress: string;
  txHash: string;
  createdAt: number;
  [key: string]: unknown;
}

export interface PaymentChannelItem {
  id: number;
  channel: string;
  config: string;
  enabled: number;
}

export interface PayOrderResult {
  payUrl: string;
  payAddress: string;
  payAmount: string;
  payToken?: string;
  payType?: string;
  qrContent?: string;
  qrImageUrl?: string;
  expiresAt?: number;
  returnUrl?: string;
  orderNo: string;
}

// ─── Billing ─────────────────────────────────────────────────────────

export interface RedeemCodeItem {
  id: number;
  code: string;
  type: "plan" | "balance";
  planId?: number;
  durationDays?: number;
  amountCents?: number;
  isActive: number;
  usedByUserId?: number;
  usedByUsername?: string;
  usedAt?: number;
  startsAt?: number;
  expiresAt?: number;
  createdAt: number;
}

export interface DiscountCodeItem {
  id: number;
  code: string;
  type: "percent" | "amount";
  value: number;
  maxUses: number;
  usedCount: number;
  planIds?: string;
  isActive: number;
  startsAt?: number;
  expiresAt?: number;
  createdAt: number;
}

export interface BalanceLogItem {
  id: number;
  userId: number;
  userName: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
  createdTime: number;
}

export interface SubscriptionPackageApiItem {
  id: number;
  type: string;
  name: string;
  description: string;
  price: number;
  validityDays: number;
  trafficLimit: number;
  portCount: number;
  speedLimit: number;
  maxRules: number;
  maxConnections: number;
  maxIPAccess: number;
  tunnelGroupIds: number[];
  autoRenew: number;
  sortOrder: number;
  enabled: number;
  shopVisible: number;
  autoBuyTrafficEnabled: number; // 标记为自动购流来源 (0/1)
  stock: number; // -1=不限，0=售罄，>0=剩余
  recommended: number; // 0=否，1=推荐
  groupId?: number; // 分组ID，null或undefined=未分组
  createdAt: number;
  updatedAt: number;
}
