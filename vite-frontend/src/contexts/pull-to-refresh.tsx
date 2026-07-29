import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export type PullToRefreshHandler = () => void | Promise<void>;

type PullToRefreshContextValue = {
  register: (handler: PullToRefreshHandler) => () => void;
  refresh: () => Promise<boolean>;
};

export const PullToRefreshContext =
  createContext<PullToRefreshContextValue | null>(null);

const REFRESH_TIMEOUT_MS = 15_000;

export function PullToRefreshProvider({ children }: { children: ReactNode }) {
  const handlerRef = useRef<PullToRefreshHandler | null>(null);
  const refreshingRef = useRef(false);

  const register = useCallback((handler: PullToRefreshHandler) => {
    handlerRef.current = handler;

    return () => {
      if (handlerRef.current === handler) {
        handlerRef.current = null;
      }
    };
  }, []);

  const refresh = useCallback(async () => {
    const handler = handlerRef.current;

    if (!handler || refreshingRef.current) return false;

    refreshingRef.current = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const handlerPromise = Promise.resolve().then(handler);

    try {
      await Promise.race([
        handlerPromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Pull-to-refresh timed out")),
            REFRESH_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      console.error("Pull-to-refresh failed:", error);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    void handlerPromise.then(
      () => {
        refreshingRef.current = false;
      },
      () => {
        refreshingRef.current = false;
      },
    );

    return true;
  }, []);

  const value = useMemo(
    () => ({ register, refresh }),
    [refresh, register],
  );

  return (
    <PullToRefreshContext.Provider value={value}>
      {children}
    </PullToRefreshContext.Provider>
  );
}
