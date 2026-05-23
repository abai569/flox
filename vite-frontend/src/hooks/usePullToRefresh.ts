import { useEffect } from "react";

export function usePullToRefresh(callback: () => void) {
  useEffect(() => {
    const handler = () => {
      callback();
      window.dispatchEvent(new CustomEvent("flvx:pulltorefresh:done"));
    };

    window.addEventListener("flvx:pulltorefresh", handler);

    return () => window.removeEventListener("flvx:pulltorefresh", handler);
  }, [callback]);
}
