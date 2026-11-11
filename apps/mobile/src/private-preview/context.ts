import { createContext, useContext } from "react";
import type { PrivateCatalogApi } from "./catalog";
export const PrivatePreviewContext = createContext<{ api: PrivateCatalogApi; lock: () => void } | null>(null);
export const usePrivatePreview = () => useContext(PrivatePreviewContext);
