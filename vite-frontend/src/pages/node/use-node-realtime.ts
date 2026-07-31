import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";

import { getToken } from "@/utils/session";

interface NodeRealtimeMessage {
  id?: string | number;
  type?: string;
  data?: unknown;
  message?: string;
}

interface UseNodeRealtimeOptions {
  onMessage: (message: NodeRealtimeMessage) => void;
  enabled?: boolean;
  mode?: "admin" | "public";
}

const MAX_STANDARD_RECONNECT_ATTEMPTS = 5;
const STANDARD_RECONNECT_DELAY_MS = 3000;
const MAX_STANDARD_RECONNECT_DELAY_MS = 15000;
const FALLBACK_RECONNECT_DELAY_MS = 10000;

const getRealtimeWsUrl = (mode: "admin" | "public"): string => {
  const baseUrl =
    axios.defaults.baseURL ||
    (import.meta.env.VITE_API_BASE
      ? `${import.meta.env.VITE_API_BASE}/api/v1/`
      : "/api/v1/");
  const wsBaseUrl = baseUrl.replace(/^http/, "ws").replace(/\/api\/v1\/$/, "");

  if (mode === "public") {
    return `${wsBaseUrl}/system-info?type=2`;
  }

  return `${wsBaseUrl}/system-info?type=0&secret=${getToken() || ""}`;
};

export const useNodeRealtime = ({
  onMessage,
  enabled = true,
  mode = "admin",
}: UseNodeRealtimeOptions) => {
  const [wsConnected, setWsConnected] = useState(false);
  const [wsConnecting, setWsConnecting] = useState(false);
  const [usingPollingFallback, setUsingPollingFallback] = useState(false);

  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    reconnectAttemptsRef.current = 0;
    setWsConnected(false);
    setWsConnecting(false);
    setUsingPollingFallback(false);

    if (!websocketRef.current) {
      return;
    }

    websocketRef.current.onopen = null;
    websocketRef.current.onmessage = null;
    websocketRef.current.onerror = null;
    websocketRef.current.onclose = null;

    if (
      websocketRef.current.readyState === WebSocket.OPEN ||
      websocketRef.current.readyState === WebSocket.CONNECTING
    ) {
      websocketRef.current.close();
    }

    websocketRef.current = null;
  }, [clearReconnectTimer]);

  const connect = useCallback(() => {
    if (!enabled) {
      return;
    }

    if (
      websocketRef.current &&
      (websocketRef.current.readyState === WebSocket.OPEN ||
        websocketRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (websocketRef.current) {
      disconnect();
    }

    try {
      setWsConnecting(true);
      websocketRef.current = new WebSocket(getRealtimeWsUrl(mode));

      websocketRef.current.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setWsConnected(true);
        setWsConnecting(false);
        setUsingPollingFallback(false);
      };

      websocketRef.current.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);

          if (parsed && typeof parsed === "object") {
            onMessageRef.current(parsed as NodeRealtimeMessage);
          }
        } catch {}
      };

      websocketRef.current.onerror = () => {};

      websocketRef.current.onclose = () => {
        websocketRef.current = null;
        setWsConnected(false);
        setWsConnecting(false);

        if (!enabled) {
          return;
        }

        reconnectAttemptsRef.current += 1;
        const exhaustedStandardRetries =
          reconnectAttemptsRef.current >= MAX_STANDARD_RECONNECT_ATTEMPTS;

        setUsingPollingFallback(exhaustedStandardRetries);

        const reconnectDelay = exhaustedStandardRetries
          ? FALLBACK_RECONNECT_DELAY_MS
          : Math.min(
              STANDARD_RECONNECT_DELAY_MS * reconnectAttemptsRef.current,
              MAX_STANDARD_RECONNECT_DELAY_MS,
            );

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, reconnectDelay);
      };
    } catch {
      setWsConnected(false);
      setWsConnecting(false);
    }
  }, [disconnect, enabled, mode]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    connect();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !websocketRef.current) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        setUsingPollingFallback(false);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      disconnect();
    };
  }, [connect, disconnect, enabled]);

  return {
    wsConnected,
    wsConnecting,
    usingPollingFallback,
    reconnectRealtime: connect,
    disconnectRealtime: disconnect,
  };
};
