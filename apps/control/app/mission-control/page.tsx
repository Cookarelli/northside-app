import Dashboard from "./dashboard";
export default function Page() {
  return (
    <Dashboard
      configured={
        Boolean(
          process.env.NORTHSIDE_DATA_DATABASE_URL &&
          process.env.OPERATOR_PASSWORD &&
          process.env.OPERATOR_PASSWORD.length >= 20,
        ) || !process.env.VERCEL
      }
    />
  );
}
export const dynamic = "force-dynamic";
