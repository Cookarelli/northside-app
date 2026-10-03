// Standalone private print view: follow the app's logout and history protections.
(() => {
  const hide = () => document.documentElement.classList.add("privacy-hidden");
  const close = () => {
    hide();
    location.replace("/signed-out");
  };
  try {
    if (localStorage.getItem("ns-privacy-lock") === "1") close();
  } catch {}
  addEventListener("pagehide", hide);
  addEventListener("pageshow", (event) => {
    if (event.persisted) {
      hide();
      location.reload();
    }
  });
  addEventListener("storage", (event) => {
    if (event.key === "ns-privacy-lock" && event.newValue === "1") close();
  });
  if (typeof BroadcastChannel !== "undefined")
    new BroadcastChannel("northside-session").onmessage = close;
  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "SESSION_LOCKED") close();
  });
  addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("print-report");
    if (button)
      button.onclick = async () => {
        try {
          await Promise.all(
            [...document.images].map((image) => image.decode()),
          );
          window.print();
        } catch {
          button.textContent = "An image did not load. Reload before printing.";
        }
      };
  });
})();
