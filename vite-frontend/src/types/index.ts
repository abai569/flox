import { SVGProps } from "react";

export type IconSvgProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

// 用户管理相关类型
export interface User {
  id: number;
  name?: string;
  user: string;
  pwd?: string;
  status: number; // 1-正常，0-禁用
  flow: number; // 流量限制 (GB)
  num: number; // 转发数量
  expTime?: number; // 过期时间戳
  flowResetTime?: number; // 流量归零日期 (1-31 号)
  createdTime?: number; // 创建时间戳
  inFlow?: number; // 下载流量 (字节)
  outFlow?: number; // 上传流量 (字节)
  dailyQuotaGB?: number;
  monthlyQuotaGB?: number;
  dailyUsedBytes?: number;
  monthlyUsedBytes?: number;
  disabledByQuota?: number;
  quotaDisabledAt?: number;
  renewalAmount?: number; // 续费金额 (分)
  balance?: number; // 可用余额 (分)
  autoRenew?: number; // 自动续费开关 (0/1)
}

export interface UserGroup {
  id: number;
  name: string;
  status: number;
}

export interface UserForm {
  id?: number;
  name?: string;
  user: string;
  pwd?: string;
  status: number;
  flow: number;
  dailyQuotaGB: number;
  monthlyQuotaGB: number;
  num: number;
  expTime: Date | null;
  flowResetTime: number;
  groupIds?: number[];
  renewalAmount?: number;
  balance?: number;
  autoRenew?: number;
}

export interface UserTunnel {
  id: number;
  userId: number;
  tunnelId: number;
  tunnelName: string;
  status: number; // 1-正常, 0-禁用
  flow: number; // 流量限制(GB)
  num: number; // 转发数量
  expTime: number; // 过期时间戳
  flowResetTime: number; // 流量归零日期
  speedId?: number | null; // 限速规则ID
  speedLimitName?: string; // 限速规则名称
  inFlow?: number; // 下载流量(字节)
  outFlow?: number; // 上传流量(字节)
  tunnelFlow?: number; // 隧道流量计算类型(1-单向, 2-双向)
}

export interface UserTunnelForm {
  tunnelId: number | null;
  flow: number;
  num: number;
  expTime: Date | null;
  flowResetTime: number;
  speedId: number | null;
}

export interface TunnelAssignItem {
  tunnelId: number;
  speedId: number | null;
}

export interface UserTunnelBatchAssignForm {
  tunnels: TunnelAssignItem[];
}

export interface Tunnel {
  id: number;
  name: string;
  entryNodeId: number;
  exitNodeId: number;
  entryNodeName?: string;
  exitNodeName?: string;
  status?: number;
  flow?: number; // 流量计算类型
}

export interface SpeedLimit {
  id: number;
  name: string;
  speed?: number;
  uploadSpeed: number;
  downloadSpeed: number;
}

export interface Pagination {
  current: number;
  size: number;
  total: number;
}

export interface UserRenewalLog {
  id: number;
  userId: number;
  userName: string;
  renewalAmount: number; // 分
  balanceBefore: number; // 分
  balanceAfter: number; // 分
  expTimeBefore: number; // 毫秒
  expTimeAfter: number; // 毫秒
  renewalTime: number; // 毫秒
  operatorName: string;
  reason: string;
}
