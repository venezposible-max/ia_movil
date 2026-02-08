import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    build: {
        // Forzamos un hash nuevo en los nombres de archivo
        rollupOptions: {
            output: {
                entryFileNames: `assets/[name].${Date.now()}.js`,
                chunkFileNames: `assets/[name].${Date.now()}.js`,
                assetFileNames: `assets/[name].${Date.now()}.[ext]`
            }
        }
    }
})
