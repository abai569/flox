import { useContext, useEffect, useLayoutEffect, useRef } from "react";

import { PullToRefreshContext } from "@/contexts/pull-to-refresh";

export function usePullToRefresh(callback: () => void | Promise<void>) {
  const context = useContext(PullToRefreshContext);
  const callbackRef = useRef(callback);

  useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!context) return;

    return context.register(() => callbackRef.current());
  }, [context]);
}
