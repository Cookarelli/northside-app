const messages: Record<string, string> = {
  not_configured: "In-store shopping is not connected yet. Ask an associate.",
  not_found:
    "We couldn’t find an approved item for this code. Try again or ask an associate.",
  invalid_request: "Use the product barcode or a Northside product QR code.",
  invalid_response:
    "This item could not be verified safely. Try again or ask an associate.",
  offline: "Connection lost. Refresh your list before retrying a change.",
  timeout:
    "The store took too long to respond. Refresh your list before retrying a change.",
  shopping_session_expired: "This shopping session ended. Start a new list.",
  session_expired: "Your session ended. Start a new list or sign in again.",
  reauthentication_required:
    "Please finish signing in before changing your list.",
  cart_owner_mismatch:
    "This list belongs to another customer session. Start a new list.",
  cart_mode_mismatch:
    "This list cannot be used in the current store connection. Start a new list.",
  cart_changed_reload:
    "Your list changed. Refresh it before making another change.",
  cancel_handoff_before_editing:
    "Cancel the counter handoff before changing your items.",
  scanned_variant_mismatch: "The scanned variant changed. Scan the item again.",
  missing_or_unverified_variant:
    "This variant is not verified for in-store shopping. Ask an associate.",
  quantity_unavailable:
    "That quantity is not available. Refresh your list, then adjust or remove the item.",
  scan_price_changed_review_required:
    "The price changed. Refresh your list, remove the item and scan it again to review the new price.",
  refresh_required:
    "This product information expired. Scan it again before adding.",
  invalid_quantity: "Choose a quantity between 1 and 99, or remove the item.",
  cart_line_limit:
    "Your list has reached its item limit. Ask an associate for help.",
  cart_line_not_found:
    "This item is no longer on your list. Refresh to continue.",
  cart_empty: "Add an item before preparing a counter handoff.",
  handoff_expired_cancel_and_retry:
    "The counter code expired. Cancel the handoff to prepare a new code.",
  permission_denied: "Camera access is off. You can enter a code instead.",
  camera_unavailable:
    "The camera couldn’t open. Enter a code or try the camera again.",
};
export const shoppingMessage = (code?: string) =>
  messages[code ?? ""] ??
  "This change could not be confirmed. Refresh your list or ask an associate.";
