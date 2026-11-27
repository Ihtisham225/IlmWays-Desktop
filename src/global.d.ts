import type { DesktopApi } from "../shared/types";

declare global {
  interface Window {
    ilmways: DesktopApi;
  }
}

declare module "*.svg" {
  const url: string;
  export default url;
}

export {};
