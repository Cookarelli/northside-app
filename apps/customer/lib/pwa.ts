export type InstallEvent = Event & {
  prompt: () => Promise<{ outcome: "accepted" | "dismissed" }>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
export function installGuidance(s: {
  standalone: boolean;
  prompt: boolean;
  ios: boolean;
  secure: boolean;
}) {
  if (s.standalone)
    return "This window is running in standalone mode. Device installation still depends on your browser.";
  if (!s.secure)
    return "Installation and push need a secure HTTPS connection. You can keep browsing here.";
  if (s.prompt)
    return "Your browser offers an install prompt. Installing is optional.";
  if (s.ios)
    return "In Safari, open Share, then Add to Home Screen if it is available. Web push on iPhone requires a supported installed home-screen app.";
  return "Use your browser’s Install app or Add to Home Screen menu if offered. This browser has not supplied an install prompt; browsing works without it.";
}
export function pushCapability(permission: string, supported: boolean) {
  return !supported
    ? "Web push is unavailable here. In-app updates remain available."
    : permission === "denied"
      ? "Push permission was denied. Change it in browser settings if you want to enable it."
      : "Push permission is optional and is requested only when you choose Enable push.";
}
