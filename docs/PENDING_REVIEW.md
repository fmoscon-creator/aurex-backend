# PENDING REVIEW — 3 cambios en server.js (backend Railway)

Nativa y PWA NO se tocan.

---

## CAMBIO 1 — API key CryptoCompare

**Dónde:** 2 lugares en server.js

**fetchCryptoPriceBatch() ~L134:**
Agrega header `authorization: Apikey CRYPTOCOMPARE_KEY` al fetch de pricemulti.
Si la env var no existe, no envía header (compatible con anonymous).

**_fetchCryptoCompareIA() ~L543-544:**
Agrega mismo header a los 2 fetch (pricemultifull + histoday).

Variable de entorno `CRYPTOCOMPARE_KEY` ya cargada en Railway por Fernando.

---

## CAMBIO 2 — Contador de calls CC + alertas de límite

**Variables globales nuevas:**
```js
let _ccCallsMonth = 0;
let _ccAlerted80k = false;
let _ccAlerted95k = false;
const CC_LIMIT = 100000;
```

**Persistencia:** Tabla `system_config` en Supabase (key: `cc_monthly_calls`).
- Al iniciar servidor → lee de Supabase (`_ccLoadCounter`)
- Cada 50 incrementos → persiste en Supabase (`_ccPersist`)
- Si el mes cambió desde última persistencia → reset a 0

**Incremento:**
- `fetchCryptoPriceBatch()` al éxito de CC → `_ccIncrement(1)`
- `_fetchCryptoCompareIA()` al hacer los 2 fetch → `_ccIncrement(2)`

**Alertas:**
- 80.000 calls → `notifyAdmin('⚠️ CryptoCompare al 80%', ...)`
- 95.000 calls → `notifyAdmin('🔴 CRITICO — CryptoCompare al 95%', ...)`
- Cada alerta se envía una sola vez por mes (flags)

**Reset mensual:** Cron `0 3 1 * *` (1ro del mes 00:00 AR) → reset counter + flags

---

## CAMBIO 3 — Kraken como fallback entre CryptoCompare y CoinGecko

**Cadena final:** Binance → CryptoCompare → **Kraken (NUEVO)** → CoinGecko → Cache

**Inserción:** Bloque nuevo entre CC y CoinGecko en `fetchCryptoPriceBatch()`.

**Endpoint:** `https://api.kraken.com/0/public/Ticker?pair=...`
- Gratuito, sin API key, sin cuenta

**Mapeo de tickers AUREX → Kraken:**
```
BTC → XXBTZUSD
ETH → XETHZUSD
XRP → XXRPZUSD
LTC → XLTCZUSD
DOGE → XDGUSD
Resto → SIMBOLOUSD (formato estándar)
```

**4 activos sin cobertura Kraken:** FTM, MKR, ROSE, THETA
- Se saltean Kraken (array `KRAKEN_SKIP`) → caen a CoinGecko

**Health:** `PREFIXES` expandido con `kraken: 'KR'`

---

## TABLA system_config (Supabase)

Necesita existir la tabla (o crearla si no existe):
```sql
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Verificación
- `node -c server.js` → OK
- Los 3 cambios son solo en server.js
- No toca nativa ni PWA
- No afecta Apple Review
