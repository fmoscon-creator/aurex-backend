# 🚨 AUREX — Sistema de Monitoreo y Alertas Admin

> **Documento vivo.** Se actualiza cada vez que agregamos, cambiamos o removemos alertas.
> Última actualización: **2026-04-21** — v2.2 (PWA 17 fallbacks + localStorage cache) (Build 15 + AsyncStorage cache + Clearbit logos) (Kraken fallback + CC counter + /api/crypto-prices)

---

## 📡 Arquitectura del sistema

```
                   ┌─────────────────┐
                   │  Backend AUREX  │
                   │  (aurex-app)    │
                   │   Railway       │
                   └────────┬────────┘
                            │ cron cada 5min
                            ▼
                   ┌─────────────────┐
                   │  healthCheck()  │
                   │  + notifyAdmin  │
                   └────────┬────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │  Evolution API  │   ← HTTP POST /message/sendText
                   │  (evo-v1)       │
                   │   Railway       │
                   └────────┬────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │ WhatsApp Business AUREX │
              │    +54 9 11 3360 2563   │
              └────────┬────────────────┘
                       │
                       ▼
              ┌─────────────────────────┐
              │  Personal Fernando      │
              │    +54 9 11 6789 1320   │
              └─────────────────────────┘
```

---

## 👤 Destinatario y canal

| Parámetro | Valor |
|-----------|-------|
| **Destinatario** (personal Fernando) | `+54 9 11 6789 1320` |
| **Emisor** (WhatsApp Business AUREX) | `+54 9 11 3360 2563` |
| **Nombre que ve el destinatario** | `Aurex` |
| **Método** | WhatsApp vía Evolution API self-hosted |
| **Variable de env backend** | `ADMIN_WHATSAPP=5491167891320` |

---

## ⏰ Cuándo se ejecuta

- **healthCheck**: `*/5 * * * *` (cada 5 minutos, 24/7)
- **refreshCryptoCache**: `*/2 * * * *` (cada 2 minutos)
- **checkAlertas**: `*/30 * * * * *` (cada 30 segundos)
- **calcularSenalesIA**: `*/5 * * * *` (cada 5 minutos)
- **dailyHealthReport**: `0 11 * * *` (08:00 AR)
- **monthlyHealthReport**: último día hábil del mes
- **CC counter reset**: `0 3 1 * *` (día 1 cada mes, 00:00 AR)

---

## 🚨 Alertas de precios crypto

| Código | Servicio | Qué detecta | Acción |
|--------|----------|-------------|--------|
| BN-XXX | Binance | Sin precio de crypto | Mitiga via CC/Kraken/CoinGecko |
| CC-XXX | CryptoCompare | CryptoCompare falla | Escala a Kraken |
| KR-XXX | Kraken | Kraken falla | Escala a CoinGecko |
| CA-XXX | Cache | Todas las fuentes fallan, usando cache stale | Alerta crítica |

**BN-002 activa** desde 18/04/2026 — Binance bloqueado en Railway, mitigada por CryptoCompare.

**Cooldown:** 15 minutos entre alertas del mismo tipo (`HEALTH_ALERT_COOLDOWN_MS = 900000`).

---

## 📊 Alertas de límite CryptoCompare

| Umbral | % | Acción | Flag |
|--------|---|--------|------|
| 80.000 calls | 80% | WhatsApp: "⚠️ CryptoCompare al 80%" | `_ccAlerted80k` |
| 95.000 calls | 95% | WhatsApp: "🔴 CRITICO — CryptoCompare al 95%" | `_ccAlerted95k` |

- **Límite:** 100.000 calls/mes (plan gratuito con API key)
- **Contador:** Variable `_ccCallsMonth`, persistida en Supabase `system_config`
- **Persistencia:** Cada 50 incrementos (no cada call)
- **Reset:** Día 1 cada mes 00:00 AR via cron `0 3 1 * *`
- **Función:** `_ccIncrement(n)` — incrementa + persiste + chequea umbrales
- **Disparo:** Una sola vez por umbral por mes (flags se resetean con el cron)

---

## 🚨 Alertas de servicios

### Evolution WhatsApp DOWN / RECUPERADO

| Aspecto | Detalle |
|---------|---------|
| **Qué detecta** | Sesión WhatsApp desconectada |
| **Cómo** | `GET /instance/connectionState/aurex`, si `state != "open"` → down |
| **Limitación** | Si Evolution está caído, NO puede mandar esta alerta por WhatsApp |

### Supabase DOWN / RECUPERADO

| Aspecto | Detalle |
|---------|---------|
| **Qué detecta** | Base de datos inaccesible |
| **Cómo** | Query `supabase.from('usuarios').select('id').limit(1)`, si error → down |

---

## 📋 Reportes automáticos ADM

### Reporte diario (08:00 AR)

**Cron:** `0 11 * * *` (11:00 UTC = 08:00 AR)

**Estructura del mensaje:**
```
📊 AUREX Daily Health Report
━━━━━━━━━━━━━━━━━━

🔌 CONEXIONES ACTUALES:
✅ Railway Backend
✅ Evolution API (state: open)
✅ Supabase
🟡 Binance → Fallback CryptoCompare OK
✅ Alpha Vantage

📊 CryptoCompare este mes: X / 100,000 calls (X%)

📋 INCIDENTES ÚLTIMAS 24H:
✅ No incidents in last 24h.

━━━━━━━━━━━━━━━━━━
aurex.live
```

**Persistencia:** Tabla `daily_reports` en Supabase
- Campos: reported_at, resolved_count, active_count, total_count, report_text, events_snapshot

### Reporte mensual (último día hábil)

**Estructura:** Resumen por service type + top 10 incidentes + uptime/downtime

**Service types:** evolution, supabase, binance, cryptocompare, kraken, cache, ia_stale

**Persistencia:** Tabla `monthly_reports` en Supabase
- Campos: reported_at, month_label, report_text, total_incidents, resolved_count, active_count, services, events_snapshot

---

## 🔗 Endpoints del sistema

| Endpoint | Método | Qué hace |
|----------|--------|----------|
| `/api/crypto-prices` | GET | Precios crypto del cache (fallback PWA/Nativa) |
| `/api/health/status` | GET | Estado completo: source, flags, events, reports |
| `/api/health/test-report` | POST | Fuerza reporte diario |
| `/api/health/test-monthly` | POST | Fuerza reporte mensual |
| `/api/whatsapp/status` | GET | Estado conexión Evolution |
| `/api/whatsapp/send` | POST | Envío WhatsApp manual |
| `/api/test-admin-alert` | POST | Test alerta admin |

---

## 🧪 Cómo probar manualmente

### Test 1 — Crypto prices endpoint
```bash
curl https://aurex-app-production.up.railway.app/api/crypto-prices
```
Respuesta esperada: `{"ok":true,"source":"cryptocompare","count":53,"prices":{...}}`

### Test 2 — Health status
```bash
curl https://aurex-app-production.up.railway.app/api/health/status
```

### Test 3 — Forzar reporte diario
```bash
curl -X POST https://aurex-app-production.up.railway.app/api/health/test-report
```

### Test 4 — Estado WhatsApp
```bash
curl https://aurex-app-production.up.railway.app/api/whatsapp/status
```
Respuesta esperada: `{"instance":{"state":"open"}}`
