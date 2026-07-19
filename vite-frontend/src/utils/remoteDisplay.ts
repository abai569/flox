export const formatRemoteDisplayText = (value?: string | null): string =>
  (value || "").replace(/\(Remote\)/g, "(Rem)");
