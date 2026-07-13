export const getConnectionStatusMeta = (
  status: "online" | "offline",
): { color: "success" | "danger"; text: string } => {
  if (status === "online") {
    return { color: "success", text: "在线" };
  }

  return { color: "danger", text: "离线" };
};

type NodeVisualState = "online" | "partial" | "offline";

export const deriveNodeVisualState = (
  members?: { status: number }[],
  paused?: number,
): { state: NodeVisualState; color: "success" | "warning" | "danger"; text: string } => {
  if (paused) {
    return { state: "offline", color: "warning", text: "已暂停" };
  }
  if (!members || members.length === 0) {
    return { state: "offline", color: "danger", text: "离线" };
  }
  const onlineCount = members.filter((m) => m.status === 1).length;

  if (onlineCount === members.length) {
    return { state: "online", color: "success", text: `全部在线 (${onlineCount})` };
  }
  if (onlineCount > 0) {
    return { state: "partial", color: "warning", text: `部分在线 (${onlineCount}/${members.length})` };
  }

  return { state: "offline", color: "danger", text: "离线" };
};
