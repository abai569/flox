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

export const deriveNodeVisualState = (
  members?: { status: number; weight?: number }[],
  paused?: number,
): { state: NodeVisualState; color: VisualColor; text: string } => {
  if (paused) {
    return { state: "offline", color: "warning", text: "已暂停" };
  }
  if (!members || members.length === 0) {
    return { state: "offline", color: "danger", text: "离线" };
  }
  const enabled = members.filter((m) => m.weight === undefined || m.weight > 0);

  if (enabled.length === 0) {
    return { state: "offline", color: "default", text: "已禁用" };
  }
  const onlineCount = enabled.filter((m) => m.status === 1).length;

  if (onlineCount === enabled.length) {
    return { state: "online", color: "success", text: `全部在线 (${onlineCount})` };
  }
  if (onlineCount > 0) {
    return { state: "partial", color: "warning", text: `部分在线 (${onlineCount}/${enabled.length})` };
  }

  return { state: "offline", color: "danger", text: "离线" };
};
