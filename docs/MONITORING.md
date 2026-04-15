# 🚨 AUREX — Sistema de Monitoreo y Alertas Admin

> **Documento vivo.** Se actualiza cada vez que agregamos, cambiamos o removemos alertas.
> Última actualización: **2026-04-15** — v1.0 (Evolution API live + health check Evolution/Supabase)

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

**Cambiar destinatario**: `railway variables --service aurex-app --set "ADMIN_WHATSAPP=XXXXXXXXXX"`

---

## ⏰ Cuándo se ejecuta

- **Cron expression**: `*/5 * * * *` (cada 5 minutos, 24/7)
- **No para**: mientras el backend AUREX y Evolution estén vivos
- **Timezone**: los timestamps de las alertas están en `America/Argentina/Buenos_Aires`

---

## 🚨 Alertas activas (v1.0)

### 1. Evolution WhatsApp DOWN / RECUPERADO

| Aspecto | Detalle |
|---------|---------|
| **Qué detecta** | Sesión WhatsApp de AUREX desconectada (iPhone apagado, deslogueado, banneado, etc.) |
| **Cómo detecta** | `GET /instance/connectionState/aurex` de Evolution. Si `state != "open"` → down |
| **Mensaje down** | `🚨 Evolution WhatsApp DOWN` + detalles |
| **Mensaje recover** | `🚨 Evolution WhatsApp RECUPERADO` + timestamp |
| **Limitación** ⚠️ | **Si Evolution está caído, NO puede mandar esta alerta por WhatsApp** (dependencia circular). Queda solo en logs de Railway. |

### 2. Supabase DOWN / RECUPERADO

| Aspecto | Detalle |
|---------|---------|
| **Qué detecta** | Base de datos Supabase inaccesible o tirando error |
| **Cómo detecta** | Query a `supabase.from('usuarios').select('id').limit(1)`. Si error → down |
| **Mensaje down** | `🚨 Supabase DOWN` + mensaje de error |
| **Mensaje recover** | `🚨 Supabase RECUPERADO` |

---

## 🔕 Anti-spam (cooldown)

- **15 minutos** entre alertas repetidas del mismo problema
- Si algo se cae y sigue caído por 1 hora → recibís solo 1 alerta (no 12)
- A los 15 min, si persiste, recibís otra alerta de recordatorio
- La alerta de **recuperación** se manda siempre que haya cruzado el cooldown

Variable en código: `HEALTH_ALERT_COOLDOWN_MS = 15 * 60 * 1000`

---

## 🧪 Cómo probar manualmente

### Test 1 — Envío genérico
```bash
curl -X POST https://aurex-app-production.up.railway.app/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "numero": "5491167891320",
    "mensaje": "Test manual de envío WhatsApp"
  }'
```

### Test 2 — Alerta admin (dispara notifyAdmin)
```bash
curl -X POST https://aurex-app-production.up.railway.app/api/test-admin-alert \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Test de alerta admin",
    "body": "Este es el canal de alertas crítico"
  }'
```

### Test 3 — Estado de la conexión WhatsApp
```bash
curl https://aurex-app-production.up.railway.app/api/whatsapp/status
```
Respuesta esperada: `{"instance": {"state": "open"}}`

---

## 🔧 Endpoints del sistema

| Método | Ruta | Uso |
|--------|------|-----|
| `POST` | `/api/whatsapp/send` | Envío genérico de WhatsApp (`{numero, mensaje}`) |
| `GET` | `/api/whatsapp/status` | Estado de la sesión Evolution |
| `POST` | `/api/test-admin-alert` | Disparar manualmente una alerta admin |

---

## 🛠️ Cómo modificar / agregar alertas

### Archivo: `server.js`

**Función clave**: `notifyAdmin(subject, body)` — ya existe.

**Ejemplo de alerta nueva** (pegar dentro de `healthCheck()` o en otro cron):
```javascript
if (algoMalo) {
  await notifyAdmin('Categoría de falla', 'Descripción detallada del problema');
}
```

**Para anti-spam**, usar el patrón de `_health` state + `lastAlertAt` timestamp.

---

## 📋 Monitoreos AÚN NO implementados (pendientes E2-E4)

Estos vienen del **cronograma AUREX** como temas estructurales post-aprobación de Apple Build 9:

### E2 — Alertas WhatsApp robustas (nivel full)
- [ ] Monitoreo de % de activos fallando por categoría
  - Si más del 10% de activos crypto no tienen precio → alerta
  - Si más del 10% de acciones USA fallan → alerta
  - Si más del 10% de futuros/commodities fallan → alerta
- [ ] Resumen diario a las 8:00 AM con estado general del sistema

### E3 — Monitoreo variables motor IA
- [ ] Alerta si cualquier variable del motor IA no actualiza en >15 min:
  - VIX, BTC Sentimiento, F&G, macro FED, geopolítica, etc.
- [ ] Alerta si la ponderación tira valores absurdos (ej: F&G en 12 hoy)

### E4 — Alerta errores de estructura
- [ ] Alertas cuando la app iOS tiene errores de render en pantallas clave
- [ ] Captura de errores JS en frontend → backend → WhatsApp admin
- [ ] Requiere: endpoint `/api/report-error` desde app + hook en `ErrorBoundary` React Native

### Otros pendientes v2+
- [ ] Monitoreo de APIs externas (Yahoo, Binance, Alpha Vantage, CoinGecko)
  - Si Yahoo Finance devuelve 429/500 por >5 min → alerta
- [ ] Canal backup si WhatsApp cae
  - Opción A: alerta por Telegram al bot existente
  - Opción B: alerta por email a `app.aurex@gmail.com`
  - Opción C: SMS vía Twilio directo a personal

---

## 📊 Logs

### Ver logs del health check en tiempo real
```bash
cd ~/Desktop/aurex-backend
railway logs --service aurex-app --deployment | grep HEALTH
```

### Ver últimas alertas enviadas (en logs de Evolution)
```bash
railway logs --service evo-v1 --deployment | tail -50
```

---

## 🔒 Consideraciones de seguridad

- **API Key Evolution** (`EVOLUTION_API_KEY`): **NUNCA commitear**. Solo en Railway env vars.
- **Token de instancia** (`aurex-instance-token-2026`): guardado en Evolution internamente, no requiere rotación.
- **Fallback Twilio**: si Evolution falla para una alerta específica, intenta mandar por Twilio automáticamente. Costos: ~$0.015/msg solo si se usa.

---

## 📅 Historial de cambios de este documento

| Fecha | Versión | Cambio |
|-------|---------|--------|
| 2026-04-15 | 1.0 | Documento inicial. Monitoreo Evolution + Supabase activo. |

---

## 🧭 Próxima actualización

Post-aprobación Apple Build 9 → implementar E2/E3/E4 y actualizar este doc con:
- Nuevas alertas agregadas
- Nuevos endpoints
- Nuevos escenarios de falla cubiertos
