import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],

  // Prevent vite from clearing the screen
  clearScreen: false,

  // Tauri expects environment variables prefixed with VITE_ or TAURI_
  envPrefix: ['VITE_', 'TAURI_'],

  css: {
    postcss: path.resolve(__dirname, 'postcss.config.cjs')
  },

  build: {
    // Tauri expects the build output in dist folder
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,

    // Target modern browsers
    target: ['es2021', 'chrome100', 'safari13'],

    // Don't minify in debug mode
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG
  },

  server: {
    port: 5173,
    host: true,
    strictPort: true
  }
});
