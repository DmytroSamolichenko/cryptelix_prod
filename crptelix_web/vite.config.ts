import fs from 'fs'
import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function servePublicDirectoryIndexes(): Plugin {
  return {
    name: 'serve-public-directory-indexes',
    configureServer(server) {
      const publicDir = path.resolve(__dirname, 'public')
      server.middlewares.use((req, res, next) => {
        const raw = req.url?.split('?')[0] ?? ''
        if (raw.includes('..')) {
          next()
          return
        }
        const relative = raw.replace(/^\/+|\/+$/g, '')
        if (!relative) {
          next()
          return
        }
        const indexFile = path.resolve(publicDir, relative, 'index.html')
        const publicRoot = path.resolve(publicDir)
        if (!indexFile.startsWith(publicRoot + path.sep) || !fs.existsSync(indexFile)) {
          next()
          return
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(fs.readFileSync(indexFile))
      })
    },
  }
}

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    servePublicDirectoryIndexes(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Same-origin /api in dev → avoids localhost/::1/CORS fetch failures to uvicorn.
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
