import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// base './' keeps asset paths relative so the app works at
// https://<user>.github.io/<repo>/ without extra configuration
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "ChoreBubbles",
        short_name: "ChoreBubbles",
        description: "A shared household chore ecosystem. Bubbles swell as chores go undone.",
        theme_color: "#0C1B26",
        background_color: "#0C1B26",
        display: "standalone",
        orientation: "portrait",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        navigateFallback: "index.html"
      }
    })
  ]
});
