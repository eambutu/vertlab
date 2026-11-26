import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

function offlineApp() {
  return {
    name: 'vertlab-offline-app',
    apply: 'build' as const,
    generateBundle: {
      order: 'post' as const,
      handler(_options, bundle) {
        const worker = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8')
        const assets = ['/index.html', ...Object.keys(bundle)
          .filter((name) => name.startsWith('assets/') && !name.endsWith('.map'))
          .sort().map((name) => `/${name}`)]
        const version = createHash('sha256').update(worker).update(JSON.stringify(assets))
          .update(readFileSync(new URL('./index.html', import.meta.url))).digest('hex').slice(0, 16)
        this.emitFile({
          type: 'asset',
          fileName: 'service-worker.js',
          source: `self.APP_VERSION = ${JSON.stringify(version)};\nself.APP_ASSETS = ${JSON.stringify(assets)};\n${worker}`,
        })
      },
    },
  } satisfies import('vite').Plugin
}

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    offlineApp(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
