/// <reference types="vite/client" />

import type { GdgApi } from "./types";

declare global {
  interface Window {
    gdg: GdgApi;
  }
}

