/// <reference types="vite/client" />

// Build-time cache buster injected via Vite `define` (see vite.config.ts). Used
// by the React Query persistence layer to drop its localStorage blob on every
// redeploy / dev restart.
declare const __HERMES_BUILD_ID__: string
