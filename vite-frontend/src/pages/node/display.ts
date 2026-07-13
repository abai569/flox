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

export const deriveNodeVisualState = (
  members?: { status: number; weight?: number }[],
  paused?: number,
): NodeVisualMeta => {
  const totalCount = members?.length ?? 0;
  if (paused) {
    return { state: "offline", color: "warning", text: "已暂停", onlineCount: 0, disabledCount: 0, totalCount, enabledCount: 0 };
  }
  if (!members || members.length === 0) {
    return { state: "offline", color: "danger", text: "离线", onlineCount: 0, disabledCount: 0, totalCount: 0, enabledCount: 0 };
  }
  const disabledCount = members.filter((m) => m.weight !== undefined && m.weight <= 0).length;
  const enabled = members.filter((m) => m.weight === undefined || m.weight > 0);
  const enabledCount = enabled.length;

  if (enabled.length === 0) {
    return { state: "offline", color: "default", text: "已禁用", onlineCount: 0, disabledCount, totalCount, enabledCount: 0 };
  }
  const onlineCount = enabled.filter((m) => m.status === 1).length;

  if (onlineCount === enabled.length) {
    return { state: "online", color: "success", text: `全部在线 (${onlineCount})`, onlineCount, disabledCount, totalCount, enabledCount };
  }
  if (onlineCount > 0) {
    return { state: "partial", color: "warning", text: `部分在线 (${onlineCount}/${enabled.length})`, onlineCount, disabledCount, totalCount, enabledCount };
  }

  return { state: "offline", color: "danger", text: "离线", onlineCount: 0, disabledCount, totalCount, enabledCount };
};
