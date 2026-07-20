export const formatRemoteDisplayText = (value?: string | null): string =>
  (value || "")
    .replace(/\(Remote\)/gi, "(Rem)")
    .replace(/(?:\s*\(Rem\)){2,}/gi, " (Rem)");
