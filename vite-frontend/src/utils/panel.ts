// Promise 封装：请求面板地址列表，返回 Promise<PanelAddress[]>
export function requestPanelAddresses(): Promise<PanelAddress[]> {
  return new Promise((resolve) => {
    const callbackName = "__panelAddressCallback_" + Date.now();
    const timeout = setTimeout(() => {
      delete (window as any)[callbackName];
      resolve([]);
    }, 5000);

    (window as any)[callbackName] = (addresses: PanelAddress[]) => {
      clearTimeout(timeout);
      delete (window as any)[callbackName];
      resolve(addresses);
    };
    getPanelAddresses(callbackName);
  });
}

export interface PanelAddress {
  name: string;
  address: string;
  inx: boolean;
}

// 获取面板地址列表
export async function getPanelAddresses(
  callback: string = "setPanelAddresses",
) {
  if (
    (window as any).JsInterface &&
    (window as any).JsInterface.getPanelAddresses
  ) {
    (window as any).JsInterface.getPanelAddresses(callback);
  } else if ((window as any).webkit && (window as any).webkit.messageHandlers) {
    (window as any).webkit.messageHandlers.getPanelAddresses.postMessage(
      callback,
    );
  }
}

// 保存面板地址
export async function savePanelAddress(name: string, address: string) {
  if ((window as any).JsInterface) {
    (window as any).JsInterface.savePanelAddress(name, address);
  } else if ((window as any).webkit && (window as any).webkit.messageHandlers) {
    (window as any).webkit.messageHandlers.savePanelAddress.postMessage({
      name,
      address,
    });
  }
}

// 设置当前面板地址
export async function setCurrentPanelAddress(name: string) {
  if ((window as any).JsInterface) {
    (window as any).JsInterface.setCurrentPanelAddress(name);
  } else if ((window as any).webkit && (window as any).webkit.messageHandlers) {
    (window as any).webkit.messageHandlers.setCurrentPanelAddress.postMessage({
      name,
    });
  }
}

// 删除面板地址
export async function deletePanelAddress(name: string) {
  if ((window as any).JsInterface) {
    (window as any).JsInterface.deletePanelAddress(name);
  } else if ((window as any).webkit && (window as any).webkit.messageHandlers) {
    (window as any).webkit.messageHandlers.deletePanelAddress.postMessage({
      name,
    });
  }
}

export function isWebViewFunc() {
  if (
    (window as any).JsInterface !== undefined &&
    (window as any).JsInterface.getPanelAddresses !== undefined
  ) {
    return true;
  } else if (
    (window as any).webkit &&
    (window as any).webkit.messageHandlers &&
    (window as any).webkit.messageHandlers.getPanelAddresses !== undefined
  ) {
    return true;
  } else {
    return false;
  }
}

// 验证面板地址格式
export function validatePanelAddress(address: string): boolean {
  if (!address.startsWith("http://") && !address.startsWith("https://")) {
    return false;
  }
  try {
    const url = new URL(address);

    return !!url.hostname;
  } catch {
    return false;
  }
}
