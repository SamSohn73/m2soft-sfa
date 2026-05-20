// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// PORT/HOST 환경변수를 읽어 dev/preview 서버 포트를 고정합니다.
// 예) PORT=4000 bun run dev
const PORT = process.env.PORT ? Number(process.env.PORT) : undefined;
const HOST = process.env.HOST ?? undefined;

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: {
      ...(PORT ? { port: PORT, strictPort: true } : {}),
      ...(HOST ? { host: HOST } : {}),
      allowedHosts: true,
    },
    preview: {
      ...(PORT ? { port: PORT, strictPort: true } : {}),
      ...(HOST ? { host: HOST } : {}),
      allowedHosts: true,
    },
  },
});
