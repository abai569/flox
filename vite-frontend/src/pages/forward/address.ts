export interface ForwardAddressItem {
  id: number;
  address: string;
  copying: boolean;
}

export type ForwardAddressAction =
  | { type: "none" }
  | { type: "copy"; text: string; label: string }
  | { type: "modal"; title: string; items: ForwardAddressItem[] };

const splitAddressEntries = (value: string): string[] => {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item);
};

export const splitAddressHostPort = (
  value: string,
): { host: string; port: string } => {
  const item = value.trim();

  if (item.startsWith("[")) {
    const closingBracket = item.indexOf("]");

    if (closingBracket > 0) {
      const suffix = item.slice(closingBracket + 1);

      return {
        host: item.slice(1, closingBracket),
        port: suffix.startsWith(":") ? suffix.slice(1) : "",
      };
    }
  }
  const colonCount = (item.match(/:/g) || []).length;

  if (colonCount === 1) {
    const separator = item.lastIndexOf(":");
    const port = item.slice(separator + 1);

    if (/^\d+$/.test(port)) {
      return { host: item.slice(0, separator), port };
    }
  }

  return { host: item.replace(/^\[|\]$/g, ""), port: "" };
};

export const formatAddressHost = (value: string): string =>
  splitAddressHostPort(value).host;

const formatAddressWithPort = (ip: string, port: number): string => {
	const host = formatAddressHost(ip);

	if (host.includes(":")) {
		return `[${host}]:${port}`;
	}

	return `${host}:${port}`;
};

export const formatInAddress = (ipString: string, port: number): string => {
  if (!ipString) {
    return "";
  }

  const items = splitAddressEntries(ipString);

  if (items.length === 0) {
    return "";
  }

	const hasPort = splitAddressHostPort(items[0]).port !== "";

  if (hasPort) {
    if (items.length === 1) {
      return items[0];
    }

    return `${items[0]} (+${items.length - 1}个)`;
  }

  if (!port) {
    return "";
  }

  if (items.length === 1) {
    return formatAddressWithPort(items[0], port);
  }

  return `${formatAddressWithPort(items[0], port)} (+${items.length - 1}个)`;
};

export const formatRemoteAddress = (addressString: string): string => {
  if (!addressString) {
    return "";
  }

  const addresses = splitAddressEntries(addressString);

  if (addresses.length === 0) {
    return "";
  }

  if (addresses.length === 1) {
    return addresses[0];
  }

  return `${addresses[0]} (+${addresses.length - 1})`;
};

export const hasMultipleAddresses = (addressString: string): boolean => {
  if (!addressString) {
    return false;
  }

  return splitAddressEntries(addressString).length > 1;
};

export const resolveForwardAddressAction = (
  addressString: string,
  port: number | null,
  title: string,
): ForwardAddressAction => {
  if (!addressString) {
    return { type: "none" };
  }

  let addresses: string[];

  if (port !== null) {
    const items = splitAddressEntries(addressString);

    if (items.length <= 1) {
      return {
        type: "copy",
        text: formatInAddress(addressString, port),
        label: title,
      };
    }

		const hasPort = splitAddressHostPort(items[0]).port !== "";

    addresses = hasPort
      ? items
      : items.map((ip) => formatAddressWithPort(ip, port));
  } else {
    addresses = splitAddressEntries(addressString);

    if (addresses.length <= 1) {
      return {
        type: "copy",
        text: addressString,
        label: title,
      };
    }
  }

  return {
    type: "modal",
    title: `${title} (${addresses.length}个)`,
    items: addresses.map((address, index) => ({
      id: index,
      address,
      copying: false,
    })),
  };
};
