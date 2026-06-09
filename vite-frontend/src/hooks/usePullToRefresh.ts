import { useEffect } from "react";

export function usePullToRefresh(callback: () => void) {
  useEffect(() => {
    const handler = () => {
      callback();
      window.dispatchEvent(new CustomEvent("flox:pulltorefresh:done"));
    };

    window.addEventListener("flox:pulltorefresh", handler);

    return () => window.removeEventListener("flox:pulltorefresh", handler);
  }, [callback]);
}
