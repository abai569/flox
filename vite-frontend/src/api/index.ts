import type {
  BatchOperationResult,
  ForwardDiagnosisApiData,
  ForwardApiItem,
  GroupPermissionApiItem,
  NodeGroupApiItem,
  NodeGroupMutationPayload,
  NodeReleaseApiItem,
  NodeApiItem,
  NodeTagApiItem,
  NodeTagMutationPayload,
  OfflineDeployPayload,
  SpeedLimitApiItem,
  TunnelBatchDeletePreviewApiData,
  TunnelBatchDeleteWithForwardsApiData,
  TunnelDeletePreviewApiData,
  TunnelDeleteWithForwardsApiData,
  TunnelDiagnosisApiData,
  TunnelGroupApiItem,
  TunnelGroupNewApiItem,
  TunnelGroupNewMutationPayload,
  TunnelListApiItem,
  TunnelListOrderPayload,
  TunnelListTunnelOrderPayload,
  UserApiItem,
  UserGroupApiItem,
  UserListQuery,
  UserPackageInfoApiData,
  UserQuotaHistoryItem,
  UserRenewalLogItem,
  UserTrafficBuyLogItem,
  UserTunnelPermissionApiItem,
  TunnelApiItem,
  UserTunnelApiItem,
  UserTunnelListQuery,
  UserMutationPayload,
  NodeMutationPayload,
  TunnelMutationPayload,
  UserQuotaResetPayload,
  UserTunnelAssignPayload,
  UserTunnelRemovePayload,
  ForwardMutationPayload,
  SpeedLimitMutationPayload,
  UpdatePasswordPayload,
  BackupImportPayload,
  NodeMetricApiItem,
  TunnelMetricApiItem,
  ServiceMonitorApiItem,
  ServiceMonitorResultApiItem,
  ServiceMonitorLimitsApiData,
  ServiceMonitorMutationPayload,
  MonitorNodeApiItem,
  MonitorNodeMetricsApiItem,
  MonitorTunnelApiItem,
  TunnelQualityApiItem,
  MonitorAccessApiData,
  MonitorPermissionApiItem,
  SystemUpgradeCheckApiData,
  SystemUpgradeRunApiData,
  SystemUpgradeVersionApiData,
  TrafficHistoryItem,
  OrderApiItem,
  PayOrderResult,
  PaymentChannelItem,
  RedeemCodeItem,
  DiscountCodeItem,
  BalanceLogItem,
  SubscriptionPackageApiItem,
} from "./types";

import axios from "axios";

import Network from "./network";

export type ReleaseChannel = "stable" | "dev";

// 登陆相关接口
export interface LoginData {
  username: string;
  password: string;
  captchaId: string;
}

export interface LoginResponse {
  token: string;
  role_id: number;
  name: string;
  requirePasswordChange?: boolean;
  isDefaultAdmin?: boolean;
}

export const login = (data: LoginData) =>
  Network.post<LoginResponse>("/user/login", data);

export const register = (data: {
  user: string;
  password: string;
  captchaId?: string;
}) => Network.post<LoginResponse>("/user/register", data);

// 用户CRUD操作 - 全部使用POST请求
export const createUser = (data: UserMutationPayload) =>
  Network.post("/user/create", data);
export const getAllUsers = (pageData: UserListQuery = {}) =>
  Network.post<UserApiItem[]>("/user/list", pageData);
export const updateUser = (data: UserMutationPayload) =>
  Network.post("/user/update", data);
export const deleteUser = (id: number) => Network.post("/user/delete", { id });
export const toggleUserAutoRenew = (id: number, autoRenew: number) =>
  Network.post("/user/toggle-auto-renew", { id, autoRenew });
export const toggleUserAutoBuyTraffic = (
  id: number,
  autoBuyTraffic: number,
  autoBuyTrafficPackageId?: number,
  autoBuyTrafficThreshold?: number,
) =>
  Network.post("/user/toggle-auto-buy-traffic", {
    id,
    autoBuyTraffic,
    ...(autoBuyTrafficPackageId !== undefined
      ? { autoBuyTrafficPackageId }
      : {}),
    ...(autoBuyTrafficThreshold !== undefined
      ? { autoBuyTrafficThreshold }
      : {}),
  });
export const getUserPackageInfo = () =>
  Network.post<UserPackageInfoApiData>("/user/package");

// 节点CRUD操作 - 全部使用POST请求
export const createNode = (data: NodeMutationPayload) =>
  Network.post("/node/create", data);
export const getNodeList = () => Network.post<NodeApiItem[]>("/node/list");
export const getDashboardNodeExpiryList = () =>
  Network.post<NodeApiItem[]>("/node/list", {});
export const updateNode = (data: NodeMutationPayload) =>
  Network.post("/node/update", data);
export const deleteNode = (id: number) => Network.post("/node/delete", { id });
export const getNodeInstallCommand = (
  id: number,
  channel: ReleaseChannel = "stable",
) => Network.post<string>("/node/install", { id, channel });
export const getNodeInstallCommandDomestic = (
  id: number,
  channel?: ReleaseChannel,
) =>
  Network.post<string>("/node/install-domestic", {
    id,
    channel: channel || "",
  });
export const getNodeInstallCommandOverseas = (
  id: number,
  channel?: ReleaseChannel,
  version?: string,
) =>
  Network.post<string>("/node/install-overseas", {
    id,
    channel: channel || "",
    version: version || "",
  });
export const getNodeInstallCommandAlternative = (
  id: number,
  channel?: ReleaseChannel,
) =>
  Network.post<string>("/node/install-alternative", {
    id,
    channel: channel || "",
  });
export const getNodeInstallCommandOffline = (id: number) =>
  Network.post<OfflineDeployPayload>("/node/install-offline", { id });
export const updateNodeOrder = (data: {
  nodes: Array<{ id: number; inx: number }>;
}) => Network.post("/node/update-order", data);
export const dismissNodeExpiryReminder = (id: number) =>
  Network.post("/node/dismiss-expiry-reminder", { id });

export const refreshNodeExpiryReminder = (id: number) =>
  Network.post("/node/refresh-expiry-reminder", { id });
export const checkNodeStatus = (nodeId?: number) => {
  const params = nodeId ? { nodeId } : {};

  return Network.post("/node/check-status", params);
};

export const upgradeNode = (
  id: number,
  version?: string,
  channel: ReleaseChannel = "stable",
) =>
  Network.post(
    "/node/upgrade",
    { id, version: version || "", channel },
    { timeout: 5 * 60 * 1000 },
  );
export const batchUpgradeNodes = (
  ids: number[],
  version?: string,
  channel: ReleaseChannel = "stable",
) =>
  Network.post(
    "/node/batch-upgrade",
    { ids, version: version || "", channel },
    { timeout: 15 * 60 * 1000 },
  );
export const getNodeReleases = (channel: ReleaseChannel = "stable") =>
  Network.post<NodeReleaseApiItem[]>("/node/releases", { channel });
export const rollbackNode = (id: number) =>
  Network.post("/node/rollback", { id });

// 隧道CRUD操作 - 全部使用POST请求
export const createTunnel = (data: TunnelMutationPayload) =>
  Network.post("/tunnel/create", data);
export const getTunnelList = () =>
  Network.post<TunnelApiItem[]>("/tunnel/list");
export const getTunnelById = (id: number) =>
  Network.post<TunnelApiItem>("/tunnel/get", { id });
export const updateTunnel = (data: TunnelMutationPayload) =>
  Network.post("/tunnel/update", data);
export const deleteTunnel = (id: number) =>
  Network.post("/tunnel/delete", { id });
export const previewTunnelDelete = (id: number) =>
  Network.post<TunnelDeletePreviewApiData>("/tunnel/delete-preview", { id });
export const deleteTunnelWithForwards = (data: {
  id: number;
  action: "replace" | "delete_forwards";
  targetTunnelId?: number;
}) =>
  Network.post<TunnelDeleteWithForwardsApiData | BatchOperationResult>(
    "/tunnel/delete-with-forwards",
    data,
  );
export const previewBatchTunnelDelete = (ids: number[]) =>
  Network.post<TunnelBatchDeletePreviewApiData>(
    "/tunnel/batch-delete-preview",
    {
      ids,
    },
  );
export const batchDeleteTunnelsWithForwards = (data: {
  ids: number[];
  action: "replace" | "delete_forwards";
  targetTunnelId?: number;
}) =>
  Network.post<TunnelBatchDeleteWithForwardsApiData>(
    "/tunnel/batch-delete-with-forwards",
    data,
  );
export const diagnoseTunnel = (tunnelId: number) =>
  Network.post<TunnelDiagnosisApiData>(
    "/tunnel/diagnose",
    { tunnelId },
    { timeout: 120 * 1000 },
  );
export const updateTunnelOrder = (data: {
  tunnels: { id: number; inx: number }[];
}) => Network.post("/tunnel/update-order", data);
export const toggleTunnelStatus = (data: { id: number; status: number }) =>
  Network.post("/tunnel/toggle-status", data);

// 用户隧道权限管理操作 - 全部使用POST请求
export const assignUserTunnel = (data: UserTunnelAssignPayload) =>
  Network.post("/tunnel/user/assign", data);
export const batchAssignUserTunnel = (data: {
  userId: number;
  tunnels: Array<{ tunnelId: number; speedId?: number | null }>;
}) => Network.post("/tunnel/user/batch-assign", data);
export const getUserTunnelList = (queryData: UserTunnelListQuery = {}) =>
  Network.post<UserTunnelPermissionApiItem[]>("/tunnel/user/list", queryData);
export const removeUserTunnel = (params: UserTunnelRemovePayload) =>
  Network.post("/tunnel/user/remove", params);
export const updateUserTunnel = (data: UserTunnelAssignPayload) =>
  Network.post("/tunnel/user/update", data);
export const batchUpdateUserTunnelStatus = (data: {
  ids: number[];
  status: number;
}) => Network.post("/tunnel/user/batch-update-status", data);
export const userTunnel = () =>
  Network.post<UserTunnelApiItem[]>("/tunnel/user/tunnel");

// 转发CRUD操作 - 全部使用POST请求
export const createForward = (data: ForwardMutationPayload) =>
  Network.post("/forward/create", data);
export const getForwardList = (params?: { current?: number; size?: number }) =>
  Network.post<{ items: ForwardApiItem[]; total: number }>(
    "/forward/list",
    params || {},
  );
export const updateForward = (data: ForwardMutationPayload) =>
  Network.post("/forward/update", data);
export const deleteForward = (id: number) =>
  Network.post("/forward/delete", { id });
export const forceDeleteForward = (id: number) =>
  Network.post("/forward/force-delete", { id });

// 转发服务控制操作 - 通过Java后端接口
export const pauseForwardService = (forwardId: number) =>
  Network.post("/forward/pause", { id: forwardId });
export const resumeForwardService = (forwardId: number) =>
  Network.post("/forward/resume", { id: forwardId });

// 转发诊断操作
export const diagnoseForward = (forwardId: number) =>
  Network.post<ForwardDiagnosisApiData>(
    "/forward/diagnose",
    { forwardId },
    { timeout: 120 * 1000 },
  );

// 转发排序操作
export const updateForwardOrder = (data: {
  forwards: Array<{ id: number; inx: number }>;
}) => Network.post("/forward/update-order", data);

// 限速规则CRUD操作 - 全部使用POST请求
export const createSpeedLimit = (data: SpeedLimitMutationPayload) =>
  Network.post("/speed-limit/create", data);
export const getSpeedLimitList = () =>
  Network.post<SpeedLimitApiItem[]>("/speed-limit/list");
export const updateSpeedLimit = (data: SpeedLimitMutationPayload) =>
  Network.post("/speed-limit/update", data);
export const deleteSpeedLimit = (id: number) =>
  Network.post("/speed-limit/delete", { id });

// 修改密码接口
export const updatePassword = (data: UpdatePasswordPayload) =>
  Network.post("/user/updatePassword", data);

// 归零流量接口
export const resetUserFlow = (data: { id: number; type: number }) =>
  Network.post("/user/reset", data);
export const resetUserQuota = (data: UserQuotaResetPayload) =>
  Network.post("/user/quota/reset", data);
export const getUserQuotaHistory = (userId: number, limit: number = 50) =>
  Network.post<UserQuotaHistoryItem[]>("/user/quota/history", {
    userId,
    limit,
  });
export const deleteUserQuotaHistory = (id: number) =>
  Network.post("/user/quota/history/delete", { id });

export const getUserRenewalLogs = (userId: number, limit: number = 50) =>
  Network.post<UserRenewalLogItem[]>("/user/renewal-logs", { userId, limit });
export const deleteUserRenewalLog = (id: number) =>
  Network.post("/user/renewal-log/delete", { id });

export const getUserTrafficBuyLogs = (userId: number, limit: number = 50) =>
  Network.post<UserTrafficBuyLogItem[]>("/user/traffic-buy-logs", { userId, limit });
export const deleteUserTrafficBuyLog = (id: number) =>
  Network.post("/user/traffic-buy-log/delete", { id });

export const getTrafficHistoryList = (userId?: number, limit: number = 50) =>
  Network.post<TrafficHistoryItem[]>("/traffic-history/list", {
    userId,
    limit,
  });
export const deleteTrafficHistoryItem = (id: number) =>
  Network.post("/traffic-history/delete", { id });

export const getUserGroups = (id: number) =>
  Network.post<number[]>("/user/groups", { id });

// 网站配置相关接口
export const getConfigs = () =>
  Network.post<Record<string, string>>("/config/list");
export const getConfigByName = (name: string) =>
  Network.post<{ name: string; value: string }>("/config/get", { name });
export const updateConfigs = (configMap: Record<string, string>) =>
  Network.post("/config/update", configMap);
export const updateConfig = (name: string, value: string) =>
  Network.post("/config/update-single", { name, value });

export const exportBackupData = () => Network.post("/backup/export");
export const importBackupData = (data: BackupImportPayload) =>
  Network.post("/backup/import", data);
export const restoreBackupData = (data: BackupImportPayload) =>
  Network.post("/backup/restore", data);

// 验证码相关接口
export const checkCaptcha = () => Network.post("/captcha/check");
export const generateCaptcha = () => Network.post(`/captcha/generate`);
export const verifyCaptcha = (data: { captchaId: string; trackData: string }) =>
  Network.post("/captcha/verify", data);

// 批量操作接口
export const batchDeleteForwards = (ids: number[]) =>
  Network.post<BatchOperationResult>("/forward/batch-delete", { ids });
export const batchPauseForwards = (ids: number[]) =>
  Network.post<BatchOperationResult>("/forward/batch-pause", { ids });
export const batchResumeForwards = (ids: number[]) =>
  Network.post<BatchOperationResult>("/forward/batch-resume", { ids });
export const batchDeleteTunnels = (ids: number[]) =>
  Network.post<BatchOperationResult>("/tunnel/batch-delete", { ids });
export const batchDeleteNodes = (ids: number[]) =>
  Network.post<BatchOperationResult>("/node/batch-delete", { ids });
export const batchResetNodeTraffic = (
  nodeIds: number[],
  reason?: string,
  inFlowBefore?: number,
  outFlowBefore?: number,
) =>
  Network.post<BatchOperationResult>("/node/batch-reset-traffic", {
    nodeIds,
    reason,
    inFlowBefore,
    outFlowBefore,
  });
export const recordNodeOfflineLog = (
  nodeId: number,
  inFlowBefore: number,
  outFlowBefore: number,
  reason?: string,
) =>
  Network.post("/node/record-offline-log", {
    nodeId,
    reason,
    inFlowBefore,
    outFlowBefore,
  });
export const batchResetForward = (forwardIds: number[]) =>
  Network.post<BatchOperationResult>("/forward/batch-reset-traffic", {
    forwardIds,
  });
export const getForwardTrafficResetLogs = (forwardId: number, limit?: number) =>
  Network.post<{
    forwardId: number;
    forwardName: string;
    logs: {
      id: number;
      forwardId: number;
      forwardName: string;
      userId: number;
      userName: string;
      resetTime: number;
      inFlowBefore: number;
      outFlowBefore: number;
      operatorId: number;
      operatorName: string;
      reason: string;
      createdTime: number;
    }[];
  }>("/forward/traffic-reset-logs", { forwardId, limit });
export const deleteForwardTrafficResetLog = (id: number) =>
  Network.post("/forward/traffic-reset-log/delete", { id });
export const getNodeTrafficResetLogs = (nodeId: number, limit?: number) =>
  Network.post<{
    nodeId: number;
    nodeName: string;
    logs: {
      id: number;
      nodeId: number;
      nodeName: string;
      resetTime: number;
      operatorId: number;
      operatorName: string;
      reason: string;
      inFlowBefore: number;
      outFlowBefore: number;
      createdTime: number;
    }[];
  }>("/node/traffic-reset-logs", { nodeId, limit });
export const deleteNodeTrafficResetLog = (id: number) =>
  Network.post("/node/traffic-reset-log/delete", { id });
export const batchRedeployForwards = (ids: number[]) =>
  Network.post<BatchOperationResult>("/forward/batch-redeploy", { ids });
export const batchRedeployTunnels = (ids: number[]) =>
  Network.post<BatchOperationResult>("/tunnel/batch-redeploy", { ids });
export const batchChangeTunnel = (data: {
  forwardIds: number[];
  targetTunnelId: number;
}) => Network.post<BatchOperationResult>("/forward/batch-change-tunnel", data);

// ─── Group & Permission Management ───────────────────────────────────

export const getTunnelGroupList = () =>
  Network.post<TunnelGroupApiItem[]>("/group/tunnel/list");
export const createTunnelGroup = (data: { name: string; status?: number }) =>
  Network.post("/group/tunnel/create", data);
export const updateTunnelGroup = (data: {
  id: number;
  name: string;
  status?: number;
}) => Network.post("/group/tunnel/update", data);
export const deleteTunnelGroup = (id: number) =>
  Network.post("/group/tunnel/delete", { id });
export const assignTunnelsToGroup = (data: {
  groupId: number;
  tunnelIds: number[];
}) => Network.post("/group/tunnel/assign", data);

export const getUserGroupList = () =>
  Network.post<UserGroupApiItem[]>("/group/user/list");
export const createUserGroup = (data: { name: string; status?: number }) =>
  Network.post("/group/user/create", data);
export const updateUserGroup = (data: {
  id: number;
  name: string;
  status?: number;
}) => Network.post("/group/user/update", data);
export const deleteUserGroup = (id: number) =>
  Network.post("/group/user/delete", { id });
export const assignUsersToGroup = (data: {
  groupId: number;
  userIds: number[];
}) => Network.post("/group/user/assign", data);

export const getGroupPermissionList = () =>
  Network.post<GroupPermissionApiItem[]>("/group/permission/list");
export const assignGroupPermission = (data: {
  userGroupId: number;
  tunnelGroupId: number;
}) => Network.post("/group/permission/assign", data);
export const removeGroupPermission = (id: number) =>
  Network.post("/group/permission/remove", { id });

// 面板共享 (Federation) 接口
export const getPeerShareList = () =>
  Network.post<Array<Record<string, unknown>>>("/federation/share/list");
export const createPeerShare = (data: {
  name: string;
  nodeId: number;
  maxBandwidth?: number;
  expiryTime?: number;
  portRangeStart?: number;
  portRangeEnd?: number;
  allowedDomains?: string;
  allowedIps?: string;
}) => Network.post("/federation/share/create", data);
export const updatePeerShare = (data: {
  id: number;
  name: string;
  maxBandwidth: number;
  expiryTime: number;
  portRangeStart: number;
  portRangeEnd: number;
  allowedDomains: string;
  allowedIps: string;
}) => Network.post("/federation/share/update", data);
export const deletePeerShare = (id: number) =>
  Network.post("/federation/share/delete", { id });
export const resetPeerShareFlow = (id: number) =>
  Network.post("/federation/share/reset-flow", { id });
export const getPeerRemoteUsageList = () =>
  Network.post<Array<Record<string, unknown>>>(
    "/federation/share/remote-usage/list",
  );
export const importRemoteNode = (data: { remoteUrl: string; token: string }) =>
  Network.post("/federation/node/import", data);

export interface BackupTypes {
  users?: boolean;
  nodes?: boolean;
  tunnels?: boolean;
  forwards?: boolean;
  userTunnels?: boolean;
  speedLimits?: boolean;
  tunnelGroups?: boolean;
  userGroups?: boolean;
  permissions?: boolean;
  configs?: boolean;
}

export const exportBackup = async (
  types: string[] = [],
  mode: "core" | "full" = "full",
) => {
  const token = window.localStorage.getItem("token");

  try {
    const response = await axios.post(
      "backup/export",
      { types, mode },
      {
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        responseType: "blob",
      },
    );

    // 检查响应是否为有效的 Blob
    if (!response.data || !(response.data instanceof Blob)) {
      throw new Error("无效的响应数据");
    }

    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement("a");

    link.href = url;
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:-]/g, "");

    link.setAttribute("download", `backup_${timestamp}_${mode}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  } catch (error: any) {
    // 如果是错误响应，尝试读取错误信息
    if (error.response?.data) {
      const reader = new FileReader();

      reader.onload = () => {
        try {
          const errorData = JSON.parse(reader.result as string);

          throw new Error(errorData.msg || "导出失败");
        } catch {
          throw new Error("导出失败，请检查后端日志");
        }
      };
      reader.readAsText(error.response.data);
    }
    throw error;
  }
};

export const importBackup = (data: BackupImportPayload) =>
  Network.post("/backup/import", data, { timeout: 5 * 60 * 1000 });

export interface AnnouncementData {
  content: string;
  enabled: number;
}

export const getAnnouncement = () =>
  Network.get<AnnouncementData>("/announcement/get");
export const updateAnnouncement = (data: AnnouncementData) =>
  Network.post("/announcement/update", data);

// License API
export interface LicenseInfo {
  valid: boolean;
  expire_time?: number;
  reason?: string;
  configured: boolean;
  has_license_key: boolean;
  license_key: string;
  domain: string;
  tier?: "free" | "premium" | "blocked";
  hmac_key?: string;
  is_trial?: boolean;
  trial_remaining_days?: number;
}

export const getLicenseInfo = () => Network.post<LicenseInfo>("/license/info");
export const updateLicenseConfig = (
  licenseKey: string,
  domain: string,
  hmacKey?: string,
  actualDomain?: string,
  actualProtocol?: string,
) =>
  Network.post("/license/config", {
    license_key: licenseKey,
    domain,
    hmac_key: hmacKey,
    actual_domain: actualDomain,
    actual_protocol: actualProtocol,
  });
export const transferLicense = (newDomain: string) =>
  Network.post("/license/transfer", { new_domain: newDomain });

export const getNodeMetrics = (
  nodeId: number,
  start?: number,
  end?: number,
) => {
  const params: Record<string, string> = {};

  if (start) params.start = String(start);
  if (end) params.end = String(end);

  return Network.get<NodeMetricApiItem[]>(
    `/monitor/nodes/${nodeId}/metrics`,
    params,
  );
};

export const getNodeMetricsLatest = (nodeId: number) =>
  Network.get<NodeMetricApiItem>(`/monitor/nodes/${nodeId}/metrics/latest`);

export const getTunnelMetrics = (
  tunnelId: number,
  start?: number,
  end?: number,
) => {
  const params: Record<string, string> = {};

  if (start) params.start = String(start);
  if (end) params.end = String(end);

  return Network.get<TunnelMetricApiItem[]>(
    `/monitor/tunnels/${tunnelId}/metrics`,
    params,
  );
};

export const getMonitorTunnels = () =>
  Network.get<MonitorTunnelApiItem[]>("/monitor/tunnels");

export const getMonitorTunnelQuality = () =>
  Network.get<TunnelQualityApiItem[]>("/monitor/tunnels/quality");

export const getMonitorTunnelQualityHistory = (
  tunnelId: number,
  start?: number,
  end?: number,
) => {
  const params: Record<string, string> = {};

  if (start) params.start = String(start);
  if (end) params.end = String(end);

  return Network.get<TunnelQualityApiItem[]>(
    `/monitor/tunnels/${tunnelId}/quality`,
    params,
  );
};

export const getServiceMonitorList = () =>
  Network.get<ServiceMonitorApiItem[]>("/monitor/services");

export const getServiceMonitorLimits = () =>
  Network.get<ServiceMonitorLimitsApiData>("/monitor/services/limits");

export const createServiceMonitor = (data: ServiceMonitorMutationPayload) =>
  Network.post<ServiceMonitorApiItem>("/monitor/services/create", data);

export const updateServiceMonitor = (data: ServiceMonitorMutationPayload) =>
  Network.post<ServiceMonitorApiItem>("/monitor/services/update", data);

export const deleteServiceMonitor = (id: number) =>
  Network.post("/monitor/services/delete", { id });

export const getServiceMonitorResults = (monitorId: number, limit = 100) =>
  Network.get<ServiceMonitorResultApiItem[]>(
    `/monitor/services/${monitorId}/results`,
    { limit: String(limit) },
  );

export const getServiceMonitorLatestResults = () =>
  Network.get<ServiceMonitorResultApiItem[]>(
    "/monitor/services/latest-results",
  );

export const runServiceMonitor = (id: number) =>
  Network.post<ServiceMonitorResultApiItem>("/monitor/services/run", { id });

export const getMonitorNodes = () =>
  Network.get<MonitorNodeApiItem[]>("/monitor/nodes");

export const getMonitorNodesPublic = () =>
  Network.getPublic<MonitorNodeApiItem[]>("/monitor/public/nodes");

export const getMonitorNodesPublicMetrics = () =>
  Network.getPublic<MonitorNodeMetricsApiItem[]>(
    "/monitor/public/nodes/metrics",
  );

export const getMonitorAccess = () =>
  Network.get<MonitorAccessApiData>("/monitor/access");

export const getMonitorPermissionList = () =>
  Network.get<MonitorPermissionApiItem[]>("/monitor/permission/list");

export const assignMonitorPermission = (userId: number, fullAccess?: number) =>
  Network.post("/monitor/permission/assign", { userId, fullAccess });

export const removeMonitorPermission = (userId: number) =>
  Network.post("/monitor/permission/remove", { userId });

export const batchAssignMonitorPermission = (userIds: number[]) =>
  Network.post("/monitor/permission/batch-assign", { userIds });

export const batchRemoveMonitorPermission = (userIds: number[]) =>
  Network.post("/monitor/permission/batch-remove", { userIds });

export const batchDeleteUsers = (ids: number[]) =>
  Network.post("/user/batch-delete", { ids });

export const batchResetUserFlow = (ids: number[]) =>
  Network.post("/user/batch-reset", { ids });

export const updateUserOrder = (users: Array<{ id: number; inx: number }>) =>
  Network.post("/user/update-order", { users });

// ─── Tunnel List Grouping ────────────────────────────────────────────

export const getTunnelListList = () =>
  Network.post<TunnelListApiItem[]>("/tunnel-list/list");

export const createTunnelList = (data: {
  name: string;
  status?: number;
  inx?: number;
}) => Network.post("/tunnel-list/create", data);

export const updateTunnelList = (data: {
  id: number;
  name: string;
  status?: number;
  inx?: number;
}) => Network.post("/tunnel-list/update", data);

export const deleteTunnelList = (id: number) =>
  Network.post("/tunnel-list/delete", { id });

export const assignTunnelsToList = (data: {
  listId: number;
  tunnelIds: number[];
}) => Network.post("/tunnel-list/assign", data);

export const updateTunnelListOrder = (data: {
  orders: TunnelListOrderPayload[];
}) => Network.post("/tunnel-list/order", data);

export const updateTunnelListTunnelOrder = (data: {
  listId: number;
  orders: TunnelListTunnelOrderPayload[];
}) => Network.post("/tunnel-list/tunnel-order", data);

// ─── Tunnel Group Management (New API for Tunnel Page) ─────────────────

export const getTunnelGroupNewList = () =>
  Network.post<TunnelGroupNewApiItem[]>("/tunnel-group-new/list");

export const createTunnelGroupNew = (data: TunnelGroupNewMutationPayload) =>
  Network.post("/tunnel-group-new/create", data);

export const updateTunnelGroupNew = (data: TunnelGroupNewMutationPayload) =>
  Network.post("/tunnel-group-new/update", data);

export const deleteTunnelGroupNew = (id: number) =>
  Network.post("/tunnel-group-new/delete", { id });

export const assignTunnelToGroupNew = (data: {
  groupId: number;
  tunnelIds: number[];
}) => Network.post("/tunnel-group-new/assign", data);

// ─── Node Group & Tag Management ─────────────────────────────────────

export const getNodeGroupList = () =>
  Network.post<NodeGroupApiItem[]>("/node-group/list");

export const createNodeGroup = (data: NodeGroupMutationPayload) =>
  Network.post("/node-group/create", data);

export const updateNodeGroup = (data: NodeGroupMutationPayload) =>
  Network.post("/node-group/update", data);

export const deleteNodeGroup = (id: number) =>
  Network.post("/node-group/delete", { id });

export const assignNodeToGroup = (nodeId: number, groupId: number | null) =>
  Network.post("/node-group/assign", { nodeId, groupId });

// ─── Package Group Management ─────────────────────────────────────

export const getPackageGroupList = () =>
  Network.post<import("@/api/types").PackageGroupApiItem[]>(
    "/package-group/list",
  );

export const createPackageGroup = (
  data: import("@/api/types").PackageGroupMutationPayload,
) => Network.post("/package-group/create", data);

export const updatePackageGroup = (
  data: import("@/api/types").PackageGroupMutationPayload,
) => Network.post("/package-group/update", data);

export const deletePackageGroup = (id: number) =>
  Network.post("/package-group/delete", { id });

export const assignPackageToGroup = (
  packageId: number,
  groupId: number | null,
) => Network.post("/package-group/assign", { packageId, groupId });

export const getNodeTagList = () =>
  Network.post<NodeTagApiItem[]>("/node-tag/list");

export const createNodeTag = (data: NodeTagMutationPayload) =>
  Network.post("/node-tag/create", data);

export const updateNodeTag = (data: NodeTagMutationPayload) =>
  Network.post("/node-tag/update", data);

export const deleteNodeTag = (id: number) =>
  Network.post("/node-tag/delete", { id });

export const assignNodeToTag = (nodeId: number, tagId: number | null) =>
  Network.post("/node-tag/assign", { nodeId, tagId });

// ─── Panel Upgrade ────────────────────────────────────────────────────

export interface PanelUpgradeCheckResponse {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
}

// ─── System Upgrade ────────────────────────────────────────────────────

export const getSystemUpgradeVersion = () =>
  Network.post<SystemUpgradeVersionApiData>("/system/version");

export const checkSystemUpgrade = (channel: ReleaseChannel = "stable") =>
  Network.post<SystemUpgradeCheckApiData>("/system/check-updates", {
    channel,
  });

export const runSystemUpgrade = (
  version?: string,
  channel: ReleaseChannel = "stable",
) =>
  Network.post<SystemUpgradeRunApiData>(
    "/system/upgrade",
    { version: version || "", channel },
    { timeout: 60 * 1000 },
  );

// ─── Payment & Shop ──────────────────────────────────────────────────

export const createOrder = (data: { productId: number; payCurrency: string }) =>
  Network.post<{
    orderId: number;
    orderNo: string;
    status: number;
    amount: number;
  }>("/order/create", {
    product_id: data.productId,
    pay_currency: data.payCurrency,
  });

export const payOrder = (orderId: number) =>
  Network.post<PayOrderResult>("/payment/pay", { order_id: orderId });

export const getOrderList = (params?: Record<string, unknown>) =>
  Network.post<{
    list: OrderApiItem[];
    total: number;
    page: number;
    size: number;
  }>("/order/list", params || {});

export const getAdminOrderList = (params?: Record<string, unknown>) =>
  Network.post<{
    list: OrderApiItem[];
    total: number;
    page: number;
    size: number;
  }>("/order/admin/list", params || {});

export const cancelOrder = (id: number) =>
  Network.post("/order/cancel", { id });

export const getOrderStatus = (orderId: number) =>
  Network.post("/order/status", { order_id: orderId });

export const deleteOrder = (id: number, force?: boolean) =>
  Network.post("/order/admin/delete", { id, force });

export const updateOrder = (data: {
  id: number;
  status?: number;
  amount?: number;
  payTime?: number;
  payCurrency?: string;
  productName?: string;
}) => Network.post("/order/admin/update", data);

export const refundOrder = (id: number) =>
  Network.post("/order/admin/refund", { id });

export const completeOrder = (id: number) =>
  Network.post("/order/admin/complete", { id });

export const batchCompleteOrders = (ids: number[]) =>
  Network.post("/order/admin/batch-complete", { ids });

export const batchRefundOrders = (ids: number[]) =>
  Network.post("/order/admin/batch-refund", { ids });

export const batchDeleteOrders = (ids: number[]) =>
  Network.post("/order/admin/batch-delete", { ids });

export const getPaymentConfigs = () =>
  Network.post<PaymentChannelItem[]>("/payment/config");

// ─── Billing ─────────────────────────────────────────────────────────

export const getBillingFeatureStatus = () =>
  Network.post<{ redemptionEnabled: number; discountEnabled: number }>(
    "/billing/feature-status",
  );

export const setBillingFeatureStatus = (data: {
  redemptionEnabled?: number;
  discountEnabled?: number;
}) => Network.post("/billing/feature-status/save", data);

export const getRedeemCodes = () =>
  Network.post<RedeemCodeItem[]>("/billing/redeem/list");

export const createRedeemCodes = (data: {
  type: string;
  code?: string;
  count?: number;
  planId?: number;
  durationDays?: number;
  amountCents?: number;
  startsAt?: number;
  expiresAt?: number;
}) => Network.post<{ codes: RedeemCodeItem[] }>("/billing/redeem/create", data);

export const deleteRedeemCode = (id: number) =>
  Network.post("/billing/redeem/delete", { id });

export const getDiscountCodes = () =>
  Network.post<DiscountCodeItem[]>("/billing/discount/list");

export const createDiscountCode = (data: {
  code: string;
  type: string;
  value: number;
  maxUses?: number;
  planIds?: number[];
  startsAt?: number;
  expiresAt?: number;
}) => Network.post<DiscountCodeItem>("/billing/discount/create", data);

export const deleteDiscountCode = (id: number) =>
  Network.post("/billing/discount/delete", { id });

export const getBalanceLogs = (data?: {
  userId?: number;
  page?: number;
  size?: number;
}) =>
  Network.post<{
    list: BalanceLogItem[];
    total: number;
    page: number;
    size: number;
  }>("/billing/balance-log/list", data || {});

export const deleteBalanceLog = (id: number) =>
  Network.post("/billing/balance-log/delete", { id });

export const cleanupBalanceLogs = () =>
  Network.post<{ deleted: number }>("/billing/balance-log/cleanup");

export const batchDeleteBalanceLogs = (ids: number[]) =>
  Network.post("/billing/balance-log/batch-delete", { ids });

// ─── Subscription Packages ─────────────────────────────────────
export const getPackageList = () =>
  Network.post<SubscriptionPackageApiItem[]>("/package/list");

export const createPackage = (data: Record<string, unknown>) =>
  Network.post("/package/create", data);

export const updatePackage = (data: Record<string, unknown>) =>
  Network.post("/package/update", data);

export const deletePackage = (id: number) =>
  Network.post("/package/delete", { id });

export const getPackageDetail = (id: number) =>
  Network.post<{
    package: SubscriptionPackageApiItem;
    tunnelGroupIds: number[];
    groupId?: number;
  }>("/package/detail", { id });

export const createPackageOrder = (data: {
  package_id: number;
  pay_currency: string;
  quantity?: number;
  pay_type?: string;
}) => Network.post<{ orderId: number }>("/package/order/create", data);

export const getStoreStatus = () =>
  Network.post<{ enabled: boolean }>("/package/store-status");

export const setStoreStatus = (data: { enabled: boolean }) =>
  Network.post("/package/store-status/save", data);

export const getPaymentStats = () =>
  Network.post<{
    paidAmount: number;
    paidOrders: number;
    pendingOrders: number;
  }>("/payment/stats");

export const assignPackageToUser = (data: {
  userId: number;
  packageId: number;
}) => Network.post("/package/assign", data);

export const togglePackageAutoBuyTraffic = (data: {
  id: number;
  enabled: number;
}) => Network.post("/package/toggle-auto-buy-traffic", data);

export const listAutoBuyTrafficPackages = () =>
  Network.post<SubscriptionPackageApiItem[]>("/package/auto-buy-traffic/list");

export const getMySubscription = () =>
  Network.post<{ subscription: any; package: any }>("/user/my-subscription");

// === Telegram Bot ===
export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
  enabled: boolean;
}

export const getTelegramConfig = async (): Promise<TelegramConfig> => {
  const res = await Network.post<Record<string, string>>("/config/list");
  const cfg: TelegramConfig = {
    bot_token: res.data?.telegram_bot_token || "",
    chat_id: res.data?.telegram_chat_id || "",
    enabled: res.data?.telegram_enabled === "true",
  };
  return cfg;
};

export const updateTelegramConfig = (token: string, chatId: string, enabled: boolean) =>
  Network.post("/config/update", {
    telegram_bot_token: token,
    telegram_chat_id: chatId,
    telegram_enabled: enabled ? "true" : "false",
  });

export const testTelegramBot = () => Network.post("/telegram/test");
