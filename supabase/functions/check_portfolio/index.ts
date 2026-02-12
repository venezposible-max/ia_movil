
// Importación desde Deno STD nativo (Seguro y Rapido)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

console.log("Check Portfolio (Ninja) Started!");

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// HELPER: Firma HMAC SHA256 NATIVA
async function hmacSha256(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const msgData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyData, { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ENDPOINTS ROTATIVOS (para evitar bloqueo de IP/USA)
// api.binance.com es el que suele bloquear AWS.
// data-api.binance.vision es oficial y a veces pasa.
// api1, api2, api3 son clusters regionales.
const SPOT_ENDPOINTS = [
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://data-api.binance.vision", // A veces solo datos públicos
  "https://api.binance.com" // Último recurso
];

// FUTURES (Suele ser estricto, pero probamos alternativas si existen)
const FUTURES_ENDPOINTS = [
  "https://fapi.binance.com",
  // No hay muchos alternates públicos para fapi, pero intentamos fapi sin www
];

// HELPER: Fetch con Redundancia
async function fetchWithRetry(endpoints: string[], path: string, options: any) {
  let lastError;
  for (const base of endpoints) {
    try {
      const url = `${base}${path}`;
      console.log(`Trying: ${url}`);
      const res = await fetch(url, options);
      if (res.ok) return res; // Éxito!

      // Si es error 451 (Geo-Restricted) o 403 (Forbidden), probamos siguiente
      const text = await res.text();
      console.warn(`Failed ${base}: ${res.status} - ${text}`);
      if (res.status === 451 || res.status === 403) continue;

      // Si es otro error (ej. clave mala), paramos
      throw new Error(`Binance Error (${res.status}): ${text}`);
    } catch (e) {
      lastError = e;
      console.error(`Network Error ${base}:`, e);
    }
  }
  throw new Error(`All endpoints failed. Last: ${lastError?.message}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const API_KEY = Deno.env.get('BINANCE_API_KEY');
    const API_SECRET = Deno.env.get('BINANCE_API_SECRET');

    if (!API_KEY || !API_SECRET) throw new Error("Faltan API Keys en Secrets.");

    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}`;
    const signature = await hmacSha256(API_SECRET, queryString);
    const headers = { 'X-MBX-APIKEY': API_KEY };

    // 1. FUTURES ACCOUNT (Balance & PnL)
    let totalBalance = 0;
    let totalUnrealizedPnL = 0;
    let positions = [];

    try {
      const futRes = await fetchWithRetry(FUTURES_ENDPOINTS, `/fapi/v2/account?${queryString}&signature=${signature}`, { headers });
      const futData = await futRes.json();

      totalBalance += parseFloat(futData.totalWalletBalance || "0");
      totalUnrealizedPnL += parseFloat(futData.totalUnrealizedProfit || "0");

      if (futData.positions) {
        positions = futData.positions
          .filter((p: any) => parseFloat(p.positionAmt) !== 0)
          .map((p: any) => ({
            symbol: p.symbol,
            size: parseFloat(p.positionAmt),
            pnl: parseFloat(p.unrealizedProfit).toFixed(2),
            entry: parseFloat(p.entryPrice).toFixed(2),
            mark: parseFloat(p.markPrice).toFixed(2),
            leverage: p.leverage
          }));
      }
    } catch (e) {
      console.error("Futures Failed (Geoblock probable):", e.message);
      // No fallamos toda la request, quizás Spot sí funciona
    }

    // 2. SPOT ACCOUNT (Balance Total de TODO, no solo USDT)
    let spotTotal = 0;
    try {
      // Usamos endpoint de Snapshot Diario que da el balance convertido a BTC/USDT (más fácil)
      // O mejor: Account info normal pero sumando todo.
      const spotRes = await fetchWithRetry(SPOT_ENDPOINTS, `/api/v3/account?${queryString}&signature=${signature}`, { headers });
      const spotData = await spotRes.json();

      // Sumar todos los balances positivos > 0
      // Nota: Esto devuelve cantidades, no valor en USD. 
      // Para simplificar sin llamar a precios de 100 monedas, sumamos SOLO USDT/USDC/BUSD directos.
      // (Calcular valor BTC requiere llamar a ticker price).
      const stablecoins = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI'];

      spotData.balances.forEach((b: any) => {
        const amount = parseFloat(b.free) + parseFloat(b.locked);
        if (amount > 0 && stablecoins.includes(b.asset)) {
          spotTotal += amount;
        }
        // Si tiene BTC, tristemente no sabremos su precio exacto aquí sin hacer otra call.
        // Por ahora, asumimos STABLES.
      });

      totalBalance += spotTotal;

    } catch (e) {
      console.error("Spot Failed:", e.message);
    }

    const response = {
      total_usd: (totalBalance + totalUnrealizedPnL).toFixed(2),
      pnl_today: totalUnrealizedPnL.toFixed(2),
      positions_count: positions.length,
      positions: positions,
      active_endpoints: "Ninja Mode"
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
