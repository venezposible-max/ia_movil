import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// DEPLOY TIMESTAMP: 2024-05-24-REV2 (Force Rebuild)
export default defineConfig(({ mode }) => {
    // Cargar variables de entorno (por si estamos en local)
    const env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [react()],
        define: {
            // Definimos variables GLOBALES directas (saltando import.meta.env)
            '__GROQ_KEY__': JSON.stringify(process.env.VITE_GROQ_API_KEY || env.VITE_GROQ_API_KEY || ''),
            '__SERPER_KEY__': JSON.stringify(process.env.VITE_SERPER_API_KEY || env.VITE_SERPER_API_KEY || ''),
        }
    }
})
