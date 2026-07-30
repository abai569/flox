export const getConnectionStatusMeta = (
  status: "online" | "offline",
): { color: "success" | "danger"; text: string } => {
  if (status === "online") {
    return { color: "success", text: "在线" };
  }

  return { color: "danger", text: "离线" };
};

type NodeVisualState = "online" | "partial" | "offline";

type VisualColor = "success" | "warning" | "danger" | "default";

export interface NodeVisualMeta {
  state: NodeVisualState;
  color: VisualColor;
  text: string;
  onlineCount: number;
  disabledCount: number;
  totalCount: number;
  enabledCount: number;
}

export type RemoteDisplayState =
  | "online"
  | "paused"
  | "expired"
  | "abnormal"
  | "offline";
export type RemoteDisplayTone = "success" | "warning" | "danger" | "default";

export const getRemoteDisplayState = (
  node: { status: number; syncError?: string },
  visualMeta: NodeVisualMeta | null,
): RemoteDisplayState => {
  switch (node.syncError) {
    case "provider_share_disabled":
      return "paused";
    case "provider_share_expired":
      return "expired";
    case "provider_share_deleted":
      return "offline";
  }
  if (node.syncError) return "offline";
  if (node.status !== 1) return visualMeta?.totalCount ? "abnormal" : "offline";
  if (visualMeta?.state === "partial") return "abnormal";

  return "online";
};

export const getRemoteDisplayMeta = (
  state: RemoteDisplayState,
): { label: string; tone: RemoteDisplayTone } => {
  switch (state) {
    case "online":
      return { label: "在线", tone: "success" };
    case "paused":
      return { label: "暂停", tone: "default" };
    case "expired":
      return { label: "过期", tone: "danger" };
    case "abnormal":
      return { label: "异常", tone: "warning" };
    default:
      return { label: "离线", tone: "danger" };
  }
};

export const deriveNodeVisualState = (
  members?: { status: number; weight?: number; unavailable?: boolean }[],
  paused?: number,
): NodeVisualMeta => {
  const totalCount = members?.length ?? 0;

  if (paused) {
    return {
      state: "offline",
      color: "default",
      text: "已暂停",
      onlineCount: 0,
      disabledCount: 0,
      totalCount,
      enabledCount: 0,
    };
  }
  if (!members || members.length === 0) {
    return {
      state: "offline",
      color: "danger",
      text: "离线",
      onlineCount: 0,
      disabledCount: 0,
      totalCount: 0,
      enabledCount: 0,
    };
  }
  const offlineCount = members.filter((m) => m.status !== 1).length;
  const disabledCount = members.filter(
    (m) => m.status === 1 && m.weight !== undefined && m.weight <= 0,
  ).length;
  const enabled = members.filter((m) => m.weight === undefined || m.weight > 0);
  const enabledCount = enabled.length;
  const onlineEnabledCount = members.filter(
    (m) => m.status === 1 && (m.weight === undefined || m.weight > 0),
  ).length;

	if (offlineCount === totalCount) {
	  return {
		state: "offline",
		color: "danger",
		text: "离线",
		onlineCount: 0,
		disabledCount,
		totalCount,
		enabledCount,
	  };
	}

  if (onlineEnabledCount === 0) {
	const hasUnavailableMember = members.some((member) => member.unavailable);

	return {
	  state: offlineCount > 0 ? "partial" : "offline",
	  color: hasUnavailableMember ? "default" : "warning",
	  text: hasUnavailableMember
		? "已暂停"
		: offlineCount > 0
		  ? "存在离线和禁用实例"
		  : "已禁用",
      onlineCount: 0,
      disabledCount,
      totalCount,
      enabledCount: 0,
    };
  }
	if (onlineEnabledCount === enabled.length && offlineCount === 0) {
	return {
	  state: disabledCount > 0 ? "partial" : "online",
	  color: disabledCount > 0 ? "warning" : "success",
	  text:
		disabledCount > 0
		  ? `存在禁用实例 (${disabledCount})`
		  : `全部在线 (${onlineEnabledCount})`,
      onlineCount: onlineEnabledCount,
      disabledCount,
      totalCount,
      enabledCount,
    };
  }
  if (onlineEnabledCount > 0) {
    return {
      state: "partial",
      color: "warning",
      text: `部分在线 (${onlineEnabledCount}/${totalCount})`,
      onlineCount: onlineEnabledCount,
      disabledCount,
      totalCount,
      enabledCount,
    };
  }

  return {
    state: "offline",
    color: "danger",
    text: "离线",
    onlineCount: 0,
    disabledCount,
    totalCount,
    enabledCount,
  };
};

export const isInstanceTrafficLimitExceeded = (instance: {
  weight?: number;
  trafficLimit?: number;
  periodNetInBytes?: number;
  periodNetOutBytes?: number;
}) => {
  const limitGB = Number(instance.trafficLimit || 0);

  if ((instance.weight ?? 1) > 0 || limitGB <= 0) return false;
  const usedBytes =
	Number(instance.periodNetInBytes || 0) +
	Number(instance.periodNetOutBytes || 0);

  return usedBytes >= limitGB * 1024 * 1024 * 1024;
};
