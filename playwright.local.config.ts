import base from "./playwright.config";

// Local-run override: reuse the dev server that's already running on :3000.
export default {
  ...base,
  webServer: base.webServer ? { ...base.webServer, reuseExistingServer: true } : undefined,
};
