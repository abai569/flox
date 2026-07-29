import { useContext, useEffect, useRef, useState } from "react";

import { PullToRefreshContext } from "@/contexts/pull-to-refresh";

const MAX_PULL = 84;
const THRESHOLD = 58;
const DIRECTION_LOCK_DISTANCE = 8;
const IGNORE_SELECTOR =
  '[data-pull-to-refresh-ignore], [role="dialog"], input, textarea, select, [contenteditable="true"]';

type GestureDirection = "pending" | "horizontal" | "vertical";

export function GlobalPullToRefresh() {
  const context = useContext(PullToRefreshContext);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentDistance = useRef(0);
  const tracking = useRef(false);
  const direction = useRef<GestureDirection>("pending");

  useEffect(() => {
    const container = document.getElementById("h5-main");

    if (!container || !context) return;

    const resetGesture = () => {
      tracking.current = false;
      direction.current = "pending";
      currentDistance.current = 0;
      if (!refreshing) setPullDistance(0);
    };

    const hasNestedScrollContainer = (target: EventTarget | null) => {
      let element = target instanceof HTMLElement ? target : null;

      while (element && element !== container) {
        const style = window.getComputedStyle(element);
        const scrollable =
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 1;

        if (scrollable) return true;
        element = element.parentElement;
      }

      return false;
    };

    const shouldIgnoreTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      (target.closest(IGNORE_SELECTOR) !== null ||
        hasNestedScrollContainer(target));

    const onTouchStart = (event: TouchEvent) => {
      if (
        refreshing ||
        event.touches.length !== 1 ||
        container.scrollTop > 0 ||
        shouldIgnoreTarget(event.target)
      ) {
        resetGesture();
        return;
      }

      startX.current = event.touches[0].clientX;
      startY.current = event.touches[0].clientY;
      currentDistance.current = 0;
      direction.current = "pending";
      tracking.current = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking.current) return;
      if (event.touches.length !== 1) {
        resetGesture();
        return;
      }

      const deltaX = event.touches[0].clientX - startX.current;
      const deltaY = event.touches[0].clientY - startY.current;

      if (direction.current === "pending") {
        if (
          Math.abs(deltaX) < DIRECTION_LOCK_DISTANCE &&
          Math.abs(deltaY) < DIRECTION_LOCK_DISTANCE
        ) {
          return;
        }
        direction.current =
          deltaY > 0 && deltaY > Math.abs(deltaX) * 1.25
            ? "vertical"
            : "horizontal";
      }

      if (direction.current !== "vertical") {
        if (direction.current === "horizontal") tracking.current = false;
        return;
      }

      if (deltaY <= 0 || container.scrollTop > 0) {
        resetGesture();
        return;
      }

      if (event.cancelable) event.preventDefault();
      currentDistance.current = Math.min(deltaY * 0.42, MAX_PULL);
      setPullDistance(currentDistance.current);
    };

    const finishGesture = async (event: TouchEvent) => {
      if (event.touches.length > 0) {
        resetGesture();
        return;
      }
      if (!tracking.current) return;

      const shouldRefresh =
        direction.current === "vertical" &&
        currentDistance.current >= THRESHOLD;

      tracking.current = false;
      direction.current = "pending";

      if (!shouldRefresh) {
        currentDistance.current = 0;
        setPullDistance(0);
        return;
      }

      setRefreshing(true);
      setPullDistance(40);
      const started = await context.refresh();

      if (!started) {
        setRefreshing(false);
        currentDistance.current = 0;
        setPullDistance(0);
        return;
      }

      setRefreshing(false);
      currentDistance.current = 0;
      setPullDistance(0);
    };

    const cancelGesture = () => resetGesture();

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", finishGesture);
    container.addEventListener("touchcancel", cancelGesture);

    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", finishGesture);
      container.removeEventListener("touchcancel", cancelGesture);
    };
  }, [context, refreshing]);

  if (pullDistance === 0 && !refreshing) return null;

  return (
    <div
      className="fixed top-0 left-0 w-full flex justify-center items-start pt-6 z-[9999] pointer-events-none transition-[transform,opacity] duration-200"
      style={{
        transform: `translateY(${refreshing ? 40 : pullDistance}px)`,
        opacity: Math.min(pullDistance / MAX_PULL, 1) || (refreshing ? 1 : 0),
        marginTop: "-40px",
      }}
    >
      <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-full flex items-center justify-center shadow-md ring-1 ring-gray-100 dark:ring-neutral-700">
        <svg
          className={`w-8 h-8 text-[#3b5998] dark:text-slate-400 ${refreshing ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          style={{
            transform: !refreshing
              ? `rotate(${pullDistance * 4}deg)`
              : undefined,
          }}
          viewBox="0 0 24 24"
        >
          <path d="M 16.5 4.21 A 9 9 0 1 1 7.5 4.21" />
        </svg>
      </div>
    </div>
  );
}
