import type { Metadata, Viewport } from "next";
import { getData } from "@/lib/services";
import { Shell } from "@/components/preview";
import "./globals.css";
import { Suspense } from "react";
import { MeasurementBridge } from "@/components/engagement-workspace";
import { fixturesAllowed } from "@/lib/policy.mjs";
import { PwaManager } from "@/components/pwa-manager";
import { PrivacyGuard } from "@/components/privacy-guard";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "Northside Collectibles • Preview",
    template: "%s | Northside",
  },
  description:
    "Northside Collectibles customer app. Local preview; integrations are not connected.",
  icons: { apple: "/pwa/icon-180.png", icon: "/pwa/icon-192.png" },
  appleWebApp: { capable: true, title: "Northside", statusBarStyle: "default" },
  robots: { index: false, follow: false },
  applicationName: "Northside Collectibles",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#123d55",
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const data = await getData();
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('ns-privacy-lock')==='1'&&location.pathname!=='/signed-out')document.documentElement.classList.add('privacy-hidden')}catch{}",
          }}
        />
      </head>
      <body>
        <PrivacyGuard />
        <PwaManager />
        <Suspense>
          <MeasurementBridge sample={fixturesAllowed(process.env)} />
        </Suspense>
        <Shell data={data}>{children}</Shell>
      </body>
    </html>
  );
}
