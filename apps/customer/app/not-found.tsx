import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty">
      <h1>That page isn’t available.</h1>
      <p>The item may be unavailable, or this feature is not enabled.</p>
      <Link className="button" href="/">
        Return home
      </Link>
    </div>
  );
}
