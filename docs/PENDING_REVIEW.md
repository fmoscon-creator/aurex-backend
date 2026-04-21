# PENDING REVIEW — PUNTO 1 + PUNTO 2 (server.js + 3 docs)

---

## PUNTO 1A — CC counter en reporte diario (server.js)

Línea agregada entre bloque CONEXIONES y bloque INCIDENTES en dailyHealthReport():
```
msg += '📊 CryptoCompare este mes: ' + _ccCallsMonth.toLocaleString() + ' / ' + CC_LIMIT.toLocaleString() + ' calls (' + Math.round(_ccCallsMonth/CC_LIMIT*100) + '%)\n\n';
```

## PUNTO 1B — Kraken en reporte mensual (server.js)

- `serviceTypes` array: agregado `'kraken'`
- `serviceLabels` objeto: agregado `kraken: 'Kraken'`

## PUNTO 2A — docs/MANUAL-ESTRUCTURA.md (NUEVO)

Documento completo: repos, funciones server.js con líneas, tablas Supabase, env vars Railway, fallback PWA y Nativa, safety points.

## PUNTO 2B — docs/MANUAL-CONEXIONES.md (NUEVO)

Documento completo: 6 fuentes de datos, cadena fallback backend/PWA/nativa, endpoint /api/crypto-prices, estado actual, consumo estimado CC.

## PUNTO 2C — docs/MONITORING.md (ACTUALIZADO v1.0 → v2.0)

Agregado: alertas crypto (BN/CC/KR/CA), alertas límite CC, reportes diario/mensual con estructura, endpoints del sistema, tests manuales.

## PUNTO 3 — Verificaciones backend (ejecutadas)

- `/api/crypto-prices` → ok:true, count:53, source:cryptocompare ✅
- `/api/health/status` → lastCryptoSource:cryptocompare, BN-002 active, 5 daily reports ✅

---

## Verificación
- `node -c server.js` → OK
