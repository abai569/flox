import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";

import App from "./App.tsx";
import { Provider } from "./provider.tsx";
import "@/styles/globals.css";

let refreshing = false;
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
    if (!registration) return;
    registration.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Provider>
      <>
        <App />
      </>
    </Provider>
  </BrowserRouter>,
);
