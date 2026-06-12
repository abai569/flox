interface TunnelChainNode {
  nodeId: number;
  port?: number;
}

interface TunnelFormInput {
  name: string;
  type: number;
  inNodeId: TunnelChainNode[];
  outNodeId?: TunnelChainNode[];
  chainNodes?: TunnelChainNode[][];
  trafficRatio: number;
  http: number;
  tls: number;
  socks: number;
  blockOther: number;
}

interface TunnelNodeInput {
  id: number;
  status: number;
}

export const createTunnelFormDefaults = () => {
  return {
    name: "",
    type: 2,
    inNodeId: [],
    outNodeId: [],
    chainNodes: [],
    flow: 1,
    trafficRatio: 1.0,
    inIp: "",
    ipPreference: "",
    status: 1,
    tunnelGroupId: null as number | null,
    remark: "",
    http: 0,
    tls: 0,
    socks: 0,
    blockOther: 0,
  };
};

export const validateTunnelForm = (
  form: TunnelFormInput,
  nodes: TunnelNodeInput[],
): Record<string, string> => {
  const errors: Record<string, string> = {};

  if (!form.name.trim()) {
    errors.name = "请输入隧道名称";
  } else if (form.name.length < 2 || form.name.length > 50) {
    errors.name = "隧道名称长度应在2-50个字符之间";
  }

  if (!form.inNodeId || form.inNodeId.length === 0) {
    errors.inNodeId = "请至少选择一个入口节点";
  } else {
    const offlineInNodes = form.inNodeId.filter((item) => {
      const node = nodes.find((n) => n.id === item.nodeId);

      return node && node.status !== 1;
    });

    if (offlineInNodes.length > 0) {
      errors.inNodeId = "所有入口节点必须在线";
    }
  }

  if (form.trafficRatio <= 0 || form.trafficRatio > 100.0) {
    errors.trafficRatio = "流量倍率须大于 0，支持小数（如 0.5）";
  }

  // 🎯 多端口验证：验证出口节点端口格式
  if (form.type === 2 && form.outNodeId && form.outNodeId.length > 0) {
    const invalidPorts = form.outNodeId
      .map((node, idx) => ({ node, idx }))
      .filter(({ node }) => node.port !== undefined && node.port !== null)
      .filter(({ node }) => {
        const port = node.port as number;

        return !Number.isInteger(port) || port < 1 || port > 65535;
      });

    if (invalidPorts.length > 0) {
      errors.outNodeId = `端口号必须在 1-65535 范围内（第 ${invalidPorts.map((p) => p.idx + 1).join(", ")} 个出口节点端口无效）`;
    }
  }

  // 🎯 多端口验证：验证转发链端口格式
  if (form.type === 2 && form.chainNodes && form.chainNodes.length > 0) {
    for (let hopIdx = 0; hopIdx < form.chainNodes.length; hopIdx++) {
      const hop = form.chainNodes[hopIdx];
      const invalidPorts = hop
        .map((node, idx) => ({ node, idx }))
        .filter(({ node }) => node.port !== undefined && node.port !== null)
        .filter(({ node }) => {
          const port = node.port as number;

          return !Number.isInteger(port) || port < 1 || port > 65535;
        });

      if (invalidPorts.length > 0) {
        errors[`chainNodes_${hopIdx}_port`] =
          `第${hopIdx + 1}跳：端口号必须在 1-65535 范围内`;
      }
    }
  }

  if (form.type === 2) {
    if (!form.outNodeId || form.outNodeId.length === 0) {
      errors.outNodeId = "请至少选择一个出口节点";
    } else {
      const offlineOutNodes = form.outNodeId.filter((item) => {
        const node = nodes.find((n) => n.id === item.nodeId);

        return node && node.status !== 1;
      });

      if (offlineOutNodes.length > 0) {
        errors.outNodeId = "所有出口节点必须在线";
      }

      const inNodeIds = form.inNodeId.map((item) => item.nodeId);
      const outNodeIds = form.outNodeId.map((item) => item.nodeId);
      const overlap = inNodeIds.filter((id) => outNodeIds.includes(id));

      if (overlap.length > 0) {
        errors.outNodeId = "隧道转发模式下，入口和出口不能有相同节点";
      }
    }
  }

  return errors;
};

export const getTunnelTypeDisplay = (type: number) => {
  switch (type) {
    case 1:
      return { text: "端口转发", color: "primary" };
    case 2:
      return { text: "隧道转发", color: "secondary" };
    default:
      return { text: "未知", color: "default" };
  }
};

export const getTunnelFlowDisplay = (flow: number) => {
  switch (flow) {
    case 1:
      return "单向计算";
    case 2:
      return "双向计算";
    default:
      return "未知";
  }
};
