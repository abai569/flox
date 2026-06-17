import { useEffect, useState } from "react";

import { isWebViewFunc } from "@/utils/panel";

export const useWebViewMode = (): { isWebView: boolean; ready: boolean } => {
  const [state, setState] = useState<{ isWebView: boolean; ready: boolean }>({
    isWebView: false,
    ready: false,
  });

  useEffect(() => {
    setState({ isWebView: isWebViewFunc(), ready: true });
  }, []);

  return state;
};
