import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface SmartTooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
}

export function SmartTooltip({ content, children, className = "" }: SmartTooltipProps) {
  const [show, setShow] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.matchMedia("(pointer: coarse)").matches);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({
      top: rect.top,
      left: rect.left + rect.width / 2,
    });
  }, []);

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // 桌面端 hover
  const handleMouseEnter = () => {
    if (!isMobile) {
      updatePosition();
      clearHideTimer();
      setShow(true);
    }
  };

  const handleMouseLeave = () => {
    if (!isMobile) {
      setShow(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile) return;
    clearLongPress();
    updatePosition();
    longPressTimerRef.current = setTimeout(() => {
      e.preventDefault();
      clearHideTimer();
      setShow(true);
      hideTimerRef.current = setTimeout(() => setShow(false), 3000);
    }, 500);
  };

  const handleTouchEnd = () => {
    clearLongPress();
  };

  const handleTouchMove = () => {
    clearLongPress();
  };

  useEffect(() => {
    return () => {
      clearHideTimer();
      clearLongPress();
    };
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        className={`inline-block select-none ${className}`}
        style={{ WebkitTouchCallout: "none" }}
        onContextMenu={(e) => e.preventDefault()}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
      >
        {children}
      </span>
      {show &&
        createPortal(
          <span
            className="fixed z-[9999] px-2 py-1.5 text-xs text-white bg-gray-900 rounded shadow-lg whitespace-pre-line pointer-events-none border border-gray-700"
            style={{
              top: position.top - 8,
              left: position.left,
              transform: "translate(-50%, -100%)",
              maxWidth: 320,
            }}
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  );
}
