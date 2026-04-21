# PENDING REVIEW — 4 cambios: CC key + contador + Kraken + fallback nativa/PWA

---

## CAMBIO 1 — API key CryptoCompare (server.js)

Header `authorization: Apikey CRYPTOCOMPARE_KEY` agregado en:
- `fetchCryptoPriceBatch()` fetch a pricemulti
- `_fetchCryptoCompareIA()` ambos fetch (pricemultifull + histoday)

Si env var no existe → no envía header (compatible anónimo).

## CAMBIO 2 — Contador calls CC + alertas (server.js)

Variables globales: `_ccCallsMonth`, `_ccAlerted80k`, `_ccAlerted95k`, `CC_LIMIT=100000`

- `_ccLoadCounter()`: al iniciar → lee de Supabase `system_config` key `cc_monthly_calls`
- `_ccIncrement(n)`: incrementa, cada 50 persiste en Supabase, alertas a 80k y 95k
- `_ccPersist()`: upsert en `system_config`
- Cron `0 3 1 * *`: reset mensual (00:00 AR)

Incrementos:
- `fetchCryptoPriceBatch()` éxito CC → `_ccIncrement(1)`
- `_fetchCryptoCompareIA()` → `_ccIncrement(2)` (2 calls por activo)

Requiere tabla:
```sql
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## CAMBIO 3 — Kraken fallback (server.js)

Insertado entre CryptoCompare y CoinGecko en `fetchCryptoPriceBatch()`.

Cadena final: Binance → CryptoCompare → **Kraken** → CoinGecko → Cache

Endpoint: `api.kraken.com/0/public/Ticker` — gratuito, sin key.

Mapeo tickers: BTC→XXBTZUSD, ETH→XETHZUSD, XRP→XXRPZUSD, LTC→XLTCZUSD, DOGE→XDGUSD. Resto: SIMBOLOUSD.

4 activos sin Kraken (FTM, MKR, ROSE, THETA) → saltan a CoinGecko.

PREFIXES expandido: `kraken: 'KR'`.

## CAMBIO 4 — Endpoint `/api/crypto-prices` + fallback nativa y PWA

### Backend (server.js)
Nuevo endpoint `GET /api/crypto-prices`:
- Expone `cryptoCache` (ya mantenido por `fetchCryptoPriceBatch`)
- Respuesta: `{ ok, source, count, prices: { BTC: {price, source, ts}, ... } }`
- Sin lógica nueva — solo expone lo que ya existe en memoria

### PWA (aurex-features.js)
En el catch de fetchBinance para tab Cripto (~L394):
- Si Binance falla → fetch a `/api/crypto-prices`
- Si responde → usa esos precios y los guarda en `_pcPrices`
- Si también falla → pantalla sin precios (igual que antes, pero ahora tiene 1 fallback)

### Nativa — PortfolioScreen.js
Después del try/catch de `fetchBinancePrices()` (~L122):
- Detecta crypto sin precio (`missing`)
- Si hay missing → fetch a `/api/crypto-prices`
- Llena `allPrices` con lo que devuelve

### Nativa — MercadosScreen.js
En el catch de fetchBinance (~L359):
- Fetch a `/api/crypto-prices`
- Llena `setPrices` con los precios del backend

### Nativa — IAScreen.js
En el catch de loadPrices (~L147):
- Fetch a `/api/crypto-prices`
- Llena `setPrices` con los precios del backend

---

## ARCHIVOS MODIFICADOS

| Archivo | Repo | Cambios |
|---------|------|---------|
| server.js | aurex-backend | Cambios 1, 2, 3, 4 (endpoint) |
| aurex-features.js | aurex-app (PWA) | Cambio 4 (fallback en catch) |
| PortfolioScreen.js | AurexApp (nativa) | Cambio 4 (fallback) |
| MercadosScreen.js | AurexApp (nativa) | Cambio 4 (fallback) |
| IAScreen.js | AurexApp (nativa) | Cambio 4 (fallback) |

## VERIFICACIÓN
- `node -c server.js` → OK
- `node -c aurex-features.js` → OK
- Nativa: no tiene syntax check local pero cambios son mínimos y pattern idéntico

## IMPACTO APPLE
- Los cambios en nativa son SOLO en catches vacíos → agregan fetch de fallback
- No cambian UI, no cambian funcionalidad visible
- Si Apple ya revisó/aprobó, estos cambios no afectan (son mejora de resiliencia)
