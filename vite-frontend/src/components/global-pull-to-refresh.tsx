import { useEffect, useState, useRef } from "react";

export function GlobalPullToRefresh() {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY = useRef(0);
  const isPulling = useRef(false);
  const currentDistance = useRef(0);

  useEffect(() => {
    const MAX_PULL = 80;
    const THRESHOLD = 60;

    const getScrollTop = (target: EventTarget | null) => {
      let node = target as HTMLElement | null;

      while (
        node &&
        node !== document.body &&
        node !== document.documentElement
      ) {
        if (node.scrollHeight > node.clientHeight) {
          const overflowY = window.getComputedStyle(node).overflowY;

          if (overflowY === "auto" || overflowY === "scroll") {
            return node.scrollTop;
          }
        }
        node = node.parentElement;
      }

      return window.scrollY || document.documentElement.scrollTop;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (getScrollTop(e.target) <= 0) {
        startY.current = e.touches[0].clientY;
        isPulling.current = true;
        currentDistance.current = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPulling.current) return;
      const y = e.touches[0].clientY;
      const distance = y - startY.current;

      if (distance > 0) {
        if (getScrollTop(e.target) <= 0) {
          if (e.cancelable) e.preventDefault();
          currentDistance.current = Math.min(distance * 0.4, MAX_PULL);
          setPullDistance(currentDistance.current);
        } else {
          isPulling.current = false;
          setPullDistance(0);
        }
      } else {
        isPulling.current = false;
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      if (!isPulling.current) return;
      isPulling.current = false;

      if (currentDistance.current >= THRESHOLD) {
        setRefreshing(true);
        setPullDistance(THRESHOLD - 20);
        window.dispatchEvent(new CustomEvent("flvx:pulltorefresh"));
      } else {
        setPullDistance(0);
        currentDistance.current = 0;
      }
    };

    const onRefreshDone = () => {
      setRefreshing(false);
      setPullDistance(0);
      currentDistance.current = 0;
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    window.addEventListener("flvx:pulltorefresh:done", onRefreshDone);

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("flvx:pulltorefresh:done", onRefreshDone);
    };
  }, []);

  if (pullDistance === 0 && !refreshing) return null;

  return (
    <div
      className="fixed top-0 left-0 w-full flex justify-center items-start pt-6 z-[9999] pointer-events-none transition-transform duration-200"
      style={{
        transform: `translateY(${refreshing ? 40 : pullDistance}px)`,
        opacity: pullDistance / 80 || (refreshing ? 1 : 0),
        marginTop: "-40px",
      }}
    >
      <div className="flex justify-center">
        <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-full flex items-center justify-center shadow-md ring-1 ring-gray-100 dark:ring-neutral-700">
          <svg
            className={`w-8 h-8 text-[#3b5998] dark:text-slate-400 ${refreshing ? "animate-spin" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2" // 🌟 粗细依然在这里随便调：1.5 偏细，2 是标准，2.5 偏粗
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              // 下拉时跟随手指旋转
              transform: !refreshing ? `rotate(${pullDistance * 4}deg)` : undefined, 
            }}
          >
            {/* 真正的极简缺口圆环 */}
            <path d="M 16.5 4.21 A 9 9 0 1 1 7.5 4.21" />
          </svg>
        </div>
      </div>
    </div>
  );
}
