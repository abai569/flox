import type { MonitorNodeInstanceGroupMemberApiItem } from "@/api/types";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import axios from "axios";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/shadcn-bridge/heroui/button";
import { StatusDot } from "@/components/status-dot";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";
import { getToken } from "@/utils/session";

type MonitorTerminalContextValue = {
  openTerminal: (member: MonitorNodeInstanceGroupMemberApiItem) => void;
};

type TerminalServerEvent = {
  event?: string;
  data?: string;
  message?: string;
  exitCode?: number;
};

const MonitorTerminalContext =
  createContext<MonitorTerminalContextValue | null>(null);

const isRealInstanceId = (instanceId?: string): boolean => {
  const value = instanceId?.trim() || "";

  return value !== "" && value.toLowerCase() !== "default";
};

const getTerminalTargetLabel = (
  member?: MonitorNodeInstanceGroupMemberApiItem | null,
): string => {
  if (!member) return "-";

  const index = Number(member.displayIndex || 0);
  const instanceName = member.displayName?.trim() || `实例 ${index > 0 ? index : "-"}`;

  return `${member.nodeName || "节点"} / ${instanceName}`;
};

const buildTerminalWSURL = (): string => {
  const apiBase = axios.defaults.baseURL || "/api/v1/";
  const apiURL = new URL(apiBase, window.location.origin);
  const base = new URL("/node-terminal/ws", apiURL.origin);

  base.protocol = apiURL.protocol === "https:" ? "wss:" : "ws:";

  return base.toString();
};

const writeTerminalLine = (terminal: Terminal | null, message: string) => {
  terminal?.writeln(`\x1b[31m${message}\x1b[0m`);
};

const terminalHelpText = "Ctrl+Shift+V 粘贴 · 右键粘贴 · Ctrl+C 中断";

export function MonitorTerminalProvider({ children }: { children: ReactNode }) {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalTarget, setTerminalTarget] =
    useState<MonitorNodeInstanceGroupMemberApiItem | null>(null);
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [terminalContainer, setTerminalContainer] =
    useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalSocketRef = useRef<WebSocket | null>(null);

  const openTerminal = useCallback(
    (member: MonitorNodeInstanceGroupMemberApiItem) => {
      setTerminalTarget(member);
      setTerminalConnected(false);
      setTerminalOpen(true);
    },
    [],
  );

  const closeTerminal = useCallback(() => {
    const socket = terminalSocketRef.current;

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "close" }));
    }
    socket?.close();
    setTerminalConnected(false);
    setTerminalOpen(false);
    setTerminalTarget(null);
  }, []);

  useEffect(() => {
    if (!terminalOpen || !terminalTarget || !terminalContainer) {
      return;
    }
    const instanceId = terminalTarget.instanceId?.trim() || "";
    const container = terminalContainer;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 10000,
      theme: {
        background: "#05070a",
        foreground: "#e5e7eb",
        cursor: "#34d399",
        selectionBackground: "#334155",
      },
    });
    const fitAddon = new FitAddon();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    const fitTerminal = () => {
      try {
        fitAddon.fit();
      } catch {}
    };
    const fitFrame = window.requestAnimationFrame(() => {
      fitTerminal();
      terminal.focus();
    });
    const fitTimer = window.setTimeout(fitTerminal, 80);

    if (!isRealInstanceId(instanceId)) {
      writeTerminalLine(terminal, "节点实例无效");

      return () => {
        window.cancelAnimationFrame(fitFrame);
        window.clearTimeout(fitTimer);
        terminal.dispose();
        if (terminalRef.current === terminal) {
          terminalRef.current = null;
        }
        if (fitAddonRef.current === fitAddon) {
          fitAddonRef.current = null;
        }
      };
    }

    const socket = new WebSocket(buildTerminalWSURL());

    terminalSocketRef.current = socket;
    terminal.writeln(
      `Connecting to ${getTerminalTargetLabel(terminalTarget)}...`,
    );

    const sendResize = () => {
      if (socket.readyState !== WebSocket.OPEN || !fitAddonRef.current) return;
      fitTerminal();
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    };

    const inputDisposable = terminal.onData((data) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "input", data }));
    });
    const resizeHandler = () => sendResize();
    const sendTerminalInput = (data: string) => {
      if (data && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    };
    const pasteFromClipboard = async () => {
      try {
        const text = await navigator.clipboard.readText();

        sendTerminalInput(text);
      } catch {
        writeTerminalLine(
          terminal,
          "浏览器拒绝读取剪贴板，请用 Ctrl+Shift+V 粘贴",
        );
      }
    };
    const contextMenuHandler = (event: MouseEvent) => {
      event.preventDefault();
      terminal.focus();
      void pasteFromClipboard();
    };
    const handlePasteShortcut = (event: KeyboardEvent): boolean => {
      const isPasteShortcut =
        (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") ||
        (event.metaKey && event.key.toLowerCase() === "v");

      if (!isPasteShortcut) {
        return false;
      }

      event.preventDefault();
      terminal.focus();
      void pasteFromClipboard();

      return true;
    };
    terminal.attachCustomKeyEventHandler((event) => !handlePasteShortcut(event));

    window.addEventListener("resize", resizeHandler);
    container.addEventListener("contextmenu", contextMenuHandler);

    socket.onopen = () => {
      fitTerminal();
      socket.send(
        JSON.stringify({
          type: "open",
          token: getToken() || "",
          nodeId: terminalTarget.nodeId,
          instanceId,
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as TerminalServerEvent;
        const eventType = payload.event || "";

        if (eventType === "ready") {
          setTerminalConnected(true);
          terminal.clear();
          terminal.focus();
          sendResize();

          return;
        }
        if (eventType === "data") {
          setTerminalConnected(true);
          terminal.write(payload.data || "");

          return;
        }
        if (eventType === "error") {
          writeTerminalLine(terminal, payload.message || "终端连接失败");

          return;
        }
        if (eventType === "exit") {
          setTerminalConnected(false);
          const extra = payload.message
            ? ` (${payload.message})`
            : "";
          terminal.writeln(
            `\r\n\x1b[33m会话已结束，退出码 ${payload.exitCode ?? 0}${extra}\x1b[0m`,
          );
        }
      } catch {
        terminal.write(String(event.data || ""));
      }
    };

    socket.onerror = () => {
      if (terminalSocketRef.current !== socket) return;
      setTerminalConnected(false);
      writeTerminalLine(terminal, "终端连接异常");
    };
    socket.onclose = () => {
      if (terminalSocketRef.current !== socket) return;
      setTerminalConnected(false);
    };

    return () => {
      window.cancelAnimationFrame(fitFrame);
      window.clearTimeout(fitTimer);
      inputDisposable.dispose();
      window.removeEventListener("resize", resizeHandler);
      container.removeEventListener("contextmenu", contextMenuHandler);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "close" }));
      }
      socket.close();
      terminal.dispose();
      if (terminalSocketRef.current === socket) {
        terminalSocketRef.current = null;
      }
      if (terminalRef.current === terminal) {
        terminalRef.current = null;
      }
      if (fitAddonRef.current === fitAddon) {
        fitAddonRef.current = null;
      }
    };
  }, [terminalOpen, terminalTarget, terminalContainer]);

  return (
    <MonitorTerminalContext.Provider value={{ openTerminal }}>
      {children}
      <Modal
        isDismissable={false}
        isOpen={terminalOpen}
        scrollBehavior="inside"
        size="4xl"
        onOpenChange={(open) => {
          if (!open) closeTerminal();
        }}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>实例终端</span>
            <span className="text-xs font-normal text-default-500">
              {getTerminalTargetLabel(terminalTarget)}
            </span>
          </ModalHeader>
          <ModalBody>
            <div
              ref={setTerminalContainer}
              aria-label="实例终端"
              className="h-[560px] overflow-hidden rounded-lg border border-default-300 bg-black p-2 shadow-inner [&_.xterm]:h-full [&_.xterm-viewport]:!overflow-y-auto"
              role="textbox"
              tabIndex={0}
              onClick={() => terminalRef.current?.focus()}
            />
          </ModalBody>
          <ModalFooter>
            <div className="mr-auto flex items-center gap-2 text-xs text-default-500">
              <StatusDot
                active={terminalConnected}
                tone={terminalConnected ? "success" : "danger"}
              />
              <span>
                {terminalConnected ? "已连接" : "未连接"} · {terminalHelpText}
              </span>
            </div>
            <Button color="danger" variant="flat" onPress={closeTerminal}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </MonitorTerminalContext.Provider>
  );
}

export function MonitorTerminalButton({
  className,
  member,
}: {
  className?: string;
  member: MonitorNodeInstanceGroupMemberApiItem;
}) {
  const terminal = useContext(MonitorTerminalContext);

  return (
    <Button
      className={className}
      color="secondary"
      isDisabled={!terminal}
      size="sm"
      variant="flat"
      onPress={() => terminal?.openTerminal(member)}
    >
      终端
    </Button>
  );
}
