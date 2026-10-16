import { InstallApp } from "@/components/pwa-manager";
export default function Page() {
  return (
    <div className="loyalty-workspace">
      <div className="page-heading">
        <p className="eyebrow">NORTHSIDE ON YOUR DEVICE</p>
        <h1>Use Northside your way</h1>
      </div>
      <InstallApp />
    </div>
  );
}
