# PENDING REVIEW — Fix cryptoCache vacío en /api/crypto-prices

**Archivo**: server.js (backend)

---

## Problema
`/api/crypto-prices` devuelve `count:0` porque `cryptoCache` solo se llena dentro de `checkAlertas()`, que solo corre si hay alertas de usuario activas en Supabase. Sin alertas → cache vacío → el fallback de nativa y PWA no sirve.

## Fix — función `refreshCryptoCache()` + cron

**Ubicación**: después de `cron.schedule('*/30 * * * * *', checkAlertas);` (~L349)

**Código exacto agregado:**
```js
// Mantener cryptoCache siempre lleno (para /api/crypto-prices fallback)
async function refreshCryptoCache() {
  const cryptoSyms = IA_ACTIVOS.filter(a => a.t === 'Cripto' || a.t === 'Stable').map(a => a.s);
  if (cryptoSyms.length > 0) await fetchCryptoPriceBatch(cryptoSyms);
}
cron.schedule('*/2 * * * *', refreshCryptoCache); // cada 2 min
setTimeout(refreshCryptoCache, 5000); // al iniciar
```

**Cómo obtiene los 53 símbolos:**
- `IA_ACTIVOS` = `require('./activos.json')` ya cargado en L508 del server.js
- Filtra `a.t === 'Cripto' || a.t === 'Stable'` = 53 activos
- Extrae `a.s` (ticker: BTC, ETH, SOL, USDT, etc.)

**Qué hace `fetchCryptoPriceBatch(cryptoSyms)`:**
- Ejecuta la cadena completa: Binance → CryptoCompare → Kraken → CoinGecko → Cache
- Cada paso exitoso escribe en `cryptoCache[sym]` (L170, L189, bloque Kraken)
- Resultado: `cryptoCache` se llena con precios de los 53 crypto/stable

**Cuándo corre:**
- Al iniciar el servidor: `setTimeout(refreshCryptoCache, 5000)` — 5 seg después del boot
- Cada 2 minutos: `cron.schedule('*/2 * * * *', refreshCryptoCache)`

**Impacto en calls CryptoCompare:**
- Si Binance responde → 0 calls a CC (Binance cubre todo)
- Si Binance falla (como ahora) → 1 call batch a CC cada 2 min = 720/día = 21.600/mes adicionales
- Total estimado con alertas: 86.400 + 21.600 = 108.000/mes → supera 100k
- Con API key registrada el límite puede ser mayor. Monitorear con el contador del Cambio 2.

---

## Verificación
- `node -c server.js` → OK
- No toca nativa ni PWA
- Usa `fetchCryptoPriceBatch` que ya existe — no agrega lógica nueva
