import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The whole app is inlined into one dist/index.html and emitted as a classic
 * IIFE rather than a module script, so the built file can simply be
 * double-clicked (file://) on any machine, with no server and no internet.
 */
const classicScript = (): Plugin => ({
  name: "classic-script-tag",
  enforce: "post",
  transformIndexHtml: {
    order: "post",
    // Runs before the single-file plugin inlines it, so the tag still has a src.
    // A classic inline script ignores `defer`, so it must also move out of
    // <head> and down to the end of <body> — otherwise it runs before #root exists.
    handler: (html) => {
      const tag = /<script\s+type="module"\s+crossorigin\s+src="[^"]*"><\/script>/.exec(html);
      if (!tag) return html;
      const classic = tag[0].replace(/\s+type="module"/, "").replace(/\s+crossorigin/, "");
      return html.replace(tag[0], "").replace("</body>", `  ${classic}\n  </body>`);
    },
  },
});

export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile(), classicScript()],
  server: {
    // The HR API only allow-lists https://hr.zilmoney.com as a CORS origin, so
    // the browser can never call it from :5173. Everything under /api/punch goes
    // to the local proxy instead, which makes it a same-origin request.
    proxy: {
      "/api/punch": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
  build: {
    target: "es2019",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: { format: "iife", inlineDynamicImports: true },
    },
  },
});
