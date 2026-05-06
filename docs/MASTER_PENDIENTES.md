# AUREX — MASTER PENDIENTES — actualizado 6-MAY-2026

## ✅ REVENUECAT — RESUELTO 6-may-2026

Status final: SA v2 (`revenuecat-aurex-v2@singular-rope-494122-g4.iam.gserviceaccount.com`) con "Valid credentials" en RevenueCat. Las 3 APIs (subscriptions, inappproducts, monetization) validadas correctamente.

Lo que pasó:
- El problema era propagación de Google: cada vez que regenerábamos credentials reseteaba el reloj de validación
- Soporte RevenueCat (ticket 75918) confirmó: hay que esperar 36+ hs sin tocar nada
- También confirmaron rol nuevo necesario: **Monitoring Viewer** (además de Pub/Sub Admin)

Pasos ejecutados al 6-may:
- Rol "Monitoring Viewer" agregado al SA v2 en GCP IAM ✅
- 4 products de Play Store importados a RevenueCat con entitlements correctos ✅
- RTDN conectado: topic Play-Store-Notifications creado en GCP + configurado en Play Console → Monetization → Real-time developer notifications ✅
- Cleanup completo: SA viejo `revenuecat-aurex` eliminado (GCP IAM + Play Console Users), offering "default" residual eliminado, 3 products residuales de Test Store eliminados ✅

Estado RevenueCat dashboard al cierre: AUREX (App Store) iOS + AUREX (Play Store) Android ambos validados. Offering current `aurex_default` con 4 packages simétricos (pro_monthly, pro_annual, elite_monthly, elite_annual). Entitlements `pro` y `elite` con products correctos asociados.

**Plan B RevenueCat → CANCELADO.** No se ejecutó. Queda documentado abajo solo como referencia futura por si vuelve a pasar.

## PLAN BUILD 8 — APROBADO POR FERNANDO + ESCRITORIO 5-may-2026

Test E2E FCM pasado al 5-may: push llegó al device de Fernando. Pipeline FCM end-to-end confirmado funcional. Build 8 cierra el feature gap entre lo prometido en metadata pública y la app real.

### Decisión sobre metadata Apple/Play
NO tocar metadata. Razones:
- Build 17 iOS lleva 11 días en review, editar metadata reinicia contador
- "Alertas push de precio" en metadata es ambiguo, los toggles actuales pueden ser interpretados como cumplimiento por un reviewer
- Build 8 con la feature de alertas puntuales cierra el gap real

Antes de pedir producción Google: Build 8 debe estar listo.

### Listado de cambios para Build 8

TAB Alertas — banners superiores:
- A. Banner nuevo "Activar Push" con switch (pide permiso si falta)
- B. Banner nuevo "Conectar Telegram" (deep-link al bot @Aurexalertas)
- C. Banner WhatsApp queda como "Próximamente" (ya está así en código)

Sistema de notificaciones — campana en header:
- D. Reemplazar modal bloqueante (Alert.alert foreground en App.js) por campana 🔔 en header de TODAS las pantallas
- E. La campana muestra SOLO alertas puntuales del usuario, NO los toggles automáticos (separación clara para no mezclar)
- F. Tap en campana → pantalla "Mis alertas" con historial
- G. En historial: marcar leída / borrar / desactivar individuales y masivos
- H. Badge numérico en campana = cantidad sin leer
- H2. Foreground push: además de la notificación del sistema operativo, también hace badge en la campana (sumar Escritorio 5-may)

Alertas puntuales por activo (cierre del feature gap principal):
- I. Watchlist + Portfolio: tap en row → modal detalle → botón nuevo "🔔 Crear alerta de precio" (sumar Escritorio 5-may: accesible desde ambos lugares, mismo modal)
- J. Mini-form de creación: dirección (arriba/abajo) + tipo (precio $ o %) + valor
- K. Conversión % → precio absoluto en cliente al crear (sin cambios de schema ni backend)

Bugs/mejoras pendientes:
- L. Fix label "MI WATCHLIST" en filtro de Alertas — clarificar cuál es
- M. Re-pensar Fix C barra termómetro (la solución actual no resolvió el overflow en Android)

### Decisiones de diseño cerradas al 6-may (mockups validados con Fernando)

UBICACIÓN CAMPANA — confirmado en las 6 TABs:
- Header derecho de cada TAB, después de los elementos existentes (LIVE / disclaimer / etc.)
- Badge rojo con número en esquina superior derecha del ícono 🔔 = cantidad de alertas SIN LEER
- Mockup HTML validado: ~/Downloads/preview-headers-6tabs.html

UBICACIÓN APRETADA EN 2 TABS (a resolver en implementación):
- Portfolio: header está LLENO (LIVE + 🌐 LanguageButton + ⚖️ disclaimer + ahora 🔔). Probable que haya que sacar 🌐 LanguageButton o moverlo dentro de Perfil
- Watchlist: botón "+ Nueva lista" tiene texto largo. Probable convertirlo a solo "+" sin texto, o moverlo abajo del header

CARDS DE ALERTAS (mockup ~/Downloads/preview-campana.html):
- Color rojo del badge OK
- Formato de cards OK
- Modo oscuro: fondo cards #1E2632 (más distinto del fondo #0D1117 que el original #161B22 que se confundía)
- Modo claro: queda como está

CREACIÓN DE ALERTA PUNTUAL:
- Lugar: Watchlist + Portfolio
- Acción: tap en row del activo → abre el modal detalle existente → ahí se suma botón nuevo "🔔 Crear alerta de precio"
- NO long-press como acción primaria (poco descubierto por usuarios)
- Mini-form: dirección (arriba/abajo) + tipo (precio $ o %) + valor numérico
- Conversión % → precio absoluto en cliente al crear (sin cambios de schema, sin cambios de backend)

SEPARACIÓN SISTEMA A vs SISTEMA B:
- Sistema A (15 toggles automáticos: variación, max/min, RSI, IA, pulse, eventos) → SIGUEN dentro de TAB Alertas como hoy
- Sistema B (alertas puntuales que el user crea manualmente sobre un activo) → SOLO se muestran en la campana del header
- NO se mezclan visualmente para evitar confusión

PANTALLA "MIS ALERTAS" (al tocar la campana):
- Lista de alertas Sistema B con cards
- Cards no leídas: borde dorado izquierdo + fondo levemente distinto + punto dorado a la derecha
- Cards leídas: más tenues
- Selección múltiple para marcar varias como leídas o borrar varias (no solo todas)
- Estado vacío con texto explicativo + CTA "Ir a Watchlist" / "Ir a Portfolio"
- Toast de confirmación al crear primera alerta: "Alerta creada. La verás aquí 🔔 cuando se dispare"

### Próximos mockups a validar antes de tocar código

1. Modal "Crear alerta de precio" (mini-form que aparece dentro del modal detalle de activo)
2. Pantalla "Mis alertas" con selección múltiple (checkboxes)
3. Estado vacío de "Mis alertas"
4. Banners "Activar Push" + "Conectar Telegram" en TAB Alertas (parte superior, arriba de toggles)
5. Caso especial Portfolio: con o sin LanguageButton

Orden de prioridad: 1 primero (corazón del feature gap), después 2/3, después 4, después 5.

## PLAN B — REVENUECAT ANDROID BYPASS (STANDBY)

Listo para activar SI ticket 75918 RevenueCat soporte no responde en 48-72hs hábiles, o responde pero no resuelve el problema.

### Resumen
Reemplazar RevenueCat para Android (solo Android) por react-native-iap que va directo a Google Play Billing. iOS queda con RevenueCat como está (P8 valid).

### Cómo funciona
Cliente Android:
- App detecta Platform.OS === 'android' → usa react-native-iap en lugar de Purchases
- User compra → Google Play Billing procesa → app obtiene receipt
- App manda receipt al backend AUREX para validar

Backend AUREX:
- Endpoint nuevo /api/iap/validate-android
- Recibe receipt → llama a Google Play Developer API → confirma compra real
- Actualiza usuarios.plan en Supabase con el plan comprado

iOS no se toca.

### Schema Supabase a agregar (cuando se ejecute)
- usuarios.subscription_status (text)
- usuarios.subscription_expires_at (timestamptz)
- usuarios.purchase_token (text)

### Trabajo estimado
1 día completo:
- Instalar react-native-iap
- Refactor SubscriptionScreen con branching Platform.OS
- Endpoint backend de validación
- Testing E2E con sandbox Google Play

### Ventajas
- Producción Google sin esperar soporte RevenueCat
- Reversible: cuando RC Android se reactive, se deshabilita el bypass con flag
- iOS sigue funcionando normal

### Desventajas
- Pierde analytics de RevenueCat solo para Android
- Schema Supabase requiere columnas nuevas
- Refactor menor cuando RC se reactive

### Cuándo NO ejecutar
Si soporte RevenueCat responde y resuelve el problema antes de 72hs. Plan B queda como contingencia.

---


## PRIORIDAD 1 — BACKEND FIREBASE-ADMIN — ✅ RESUELTO 5-may-2026

Estado: COMPLETADO al cierre del 5-may. Pipeline FCM end-to-end integrado en backend Railway.

Hecho:
- npm install firebase-admin v13.8.0 (commit e823d40)
- Env var FIREBASE_SERVICE_ACCOUNT_B64 cargada en Railway via CLI (base64 del Service Account JSON)
- ws package agregado para Node 20 + Supabase realtime (commits 455a36e + 6e70d20)
- Init firebase-admin en server.js (commit 9e899cf)
- Funcion sendPushFCM creada con Android channel aurex_default + priority high (commit c45131b)
- Integracion en dispararAlerta + columna fcm_enviado en alertas_historial (commit 713991c)
- Logs Railway confirmados: "[FCM] firebase-admin initialized OK (project: aurex-app-8d985)"

Bloqueador test E2E con Fernando: fmoscon@gmail.com no tiene fila en tabla usuarios todavia. Se crea cuando Fernando instale Build 7 con Fix A y se loguee. Hasta entonces NO se puede validar end-to-end con su cuenta. Otras cuentas (tmbus1706 = hijo) si tienen fcm_token y se podria validar con ellas.

Service account JSON original: ~/Downloads/aurex-app-8d985-firebase-adminsdk-fbsvc-f02d2b2a6c.json

## PRIORIDAD 1B — REVENUECAT ↔ PLAY STORE INTEGRATION (BLOQUEADO 5-may-2026)

Problema: RevenueCat sigue mostrando "Credentials need attention" para la integracion AUREX (Play Store) despues de configurar TODO lo verificable correctamente. Sin esto las compras Android no se pueden validar a pesar de que los 4 productos esten cargados en Play Console.

Estado al cierre 5-may:

LADO RevenueCat (correcto):
- Entitlements pro y elite activos con products correctos
- Offering aurex_default (current) con 4 packages renombrados simetricamente: pro_monthly, pro_annual, elite_monthly, elite_annual
- App Store (iOS): P8 key S444Z23FMB.p8 cargada con "Valid credentials"
- Play Store: SA v2 cargado con JSON correcto (Key ID 673c2094a2)

LADO GCP (correcto):
- Proyecto: singular-rope-494122-g4 (My Project 47952)
- Cloud Pub/Sub API: HABILITADA
- Google Play Android Developer API: HABILITADA
- SA principal: revenuecat-aurex@singular-rope-494122-g4.iam.gserviceaccount.com (key vieja cf622bf47e + key nueva 673c2094a2 — ambas funcionales)
- SA v2 nuevo: revenuecat-aurex-v2@singular-rope-494122-g4.iam.gserviceaccount.com con rol Pub/Sub Admin

LADO Play Console (correcto):
- 4 suscripciones cargadas y activas: PRO Mensual ($9.99), PRO Anual ($89.99), ELITE Mensual ($19.99), ELITE Anual ($179.99)
- Product IDs identicos a Apple incluyendo elite.monthly2 con sufijo 2
- Periodos de gracia: 7 dias mensuales, 14 dias anuales
- Sin trials ni intro offers
- 174 paises (vs 175 Apple — diferencia normal)
- SA v2 ACTIVO en Users and permissions con permisos cuenta (View financial data + Manage orders) y permisos app AUREX
- Play Console version 2026: NO existe seccion "API access" / "Linked GCP projects" en el UI — Google migro ese flow. El link GCP↔Play es automatico cuando el SA esta en Users and permissions con permisos correctos.

PESE A TODO ESO RevenueCat sigue rechazando con "Credentials need attention". No hay mas palancas tecnicas obvias para mover.

Hipotesis activas:
1. Propagacion server-side de Google (puede tardar mas de 30 min en algunos casos cuando se combinan cambios de IAM + APIs habilitadas + permisos Play). Probabilidad media.
2. RevenueCat tiene un loop de validacion atascado en error que requiere intervention de soporte. Probabilidad media.
3. Falta consent/agreement adicional invisible en alguna API. Probabilidad baja.

Plan acordado al cierre:
1. Esperar 30 minutos completos desde la habilitacion de Google Play Android Developer API
2. Verificar GCP → APIs & Services → Dashboard → Google Play Android Developer API → si hay banner "Agreement required"
3. Si pasados 30 min sigue fallando → escalar a soporte RevenueCat con paquete de info tecnica (CODE lo arma)

Lo que NO hacer:
- NO crear otro SA mas (saturar el proyecto sin razon, el v2 esta correcto)
- NO borrar y rehacer la app en RevenueCat (ya descartado que sirva)
- NO tocar mas permisos en Play Console (ya estan exactos como pide RevenueCat)
- NO tocar GCP (todo correcto)

Doc visible para el equipo: docs/SUSCRIPCIONES.md en repo AurexApp (creado 5-may, NO commiteado todavia hasta resolver Play Store side completamente).

Items independientes pendientes (no bloquean lo anterior):
- appUserID en Purchases.configure (App.js): hoy se llama sin appUserID → identidades anonimas por device, plan no se hereda al cambiar device. Diff a producir cuando se pida.
- Webhook RevenueCat → backend AUREX para sincronizar usuarios.plan en Supabase post-compra. Segunda tanda.
- Localizaciones Apple en otros 7 idiomas (ES/PT/FR/IT/ZH/HI/AR): sin verificar. Play se cargo solo en EN.
- Cleanup post-resolucion: archivar offering "default" residual + borrar 3 products de Test Store + eliminar SA viejo revenuecat-aurex despues de confirmar que v2 funciona.

## PRIORIDAD 2 — BUILD 7 ANDROID (URGENTE — 1/4 hecho)

- Fix A: Race condition App.js — mover registerForPushNotifications a onAuthStateChange filtrando SIGNED_IN e INITIAL_SESSION → ✅ HECHO 5-may (commit 1fd0370 en branch dev)
- Fix B: Error string fijo update-0-rows-or-error reemplazar por error real de Supabase → PENDIENTE (plan completo armado por CODE, esperando OK Escritorio)
- Fix C: Barra termometro de riesgo se sale del limite derecho de la card en Android → PENDIENTE (plan armado: descontar gaps de barW antes de calcular proporciones)
- Fix D: Icono ojo en campo contrasena en pantalla de login (tambien aplica Build 18 iOS) → PENDIENTE (plan armado: state showPassword + wrapper + 3 estilos)
- Fix E (ya aplicado en Supabase 5-may): RLS politica INSERT usuarios WITH CHECK auth.uid() = id

Despues de Fix B/C/D commiteados → bump versionCode a 7, compilar AAB con backup en ~/AurexApp/backups/aab/ (NO dentro de build/), subir a Play Console Internal Testing.

## PRIORIDAD 3 — BUILD 18 iOS (BLOQUEADO)

Problema: react-native-svg falla con New Architecture. Issue #8883 invertase + #2613 software-mansion. 12 intentos Podfile fallados.

Solucion propuesta: Deshabilitar New Architecture en iOS. Reversible.

5 archivos iOS modificados sin commitear pendientes de decision.

## PRIORIDAD 4 — BUILD 17 iOS RESPUESTA APPLE

Estado: Submitted 24-abr-2026. Pendiente de revision hace 11 dias sin respuesta.

Accion: Pedir Expedited Review desde App Store Connect con justificacion bug fix critico.

REGLA NUEVA: Escritorio pregunta estado Apple en CADA sesion sin excepcion.

## PRIORIDAD 5 — WHATSAPP BUSINESS SOLUCION REAL

Problema: Bloqueado segunda vez. WA_EVOLUTION_PAUSED=true activo. Riesgo perder linea 2563 definitivamente.

Solucion a evaluar: Twilio ya instalado en backend como fallback. Evaluar si alcanza el volumen o si se necesita herramienta adicional en Railway.

Estado actual: Evolution API pausada, Telegram cubre 100% alertas operativas.

## PRIORIDAD 6 — PENDIENTES TECNICOS DETECTADOS

- TG-001: Delays en reportes Telegram activo desde 2-may. Diagnostico postergado.
- BN-002: Binance bloqueado en Railway, mitigado via CryptoCompare. Decision postergada.
- Login assets multi-idioma: 16 PNGs en ~/Downloads/onboarding/login/ sin wirear en LoginScreen.js
- QA pre-build onboarding v2 en simulador Android pendiente
- Backup AAB Build 5 perdido (no critico, disponible en Play Console)
- mariano17bsas nunca se logueo en la app, verificar FCM end-to-end pendiente

## ROLLBACK POINTS

- PRE-BUILD3: 072e492 (tag backup-pre-build3-4may, 2-may-2026)
- BUILD 6 HEAD dev: 3ef97e6 (4-may-2026)
- MAIN INTOCADO: 1b319b5 (11-abr-2026)

## REGLAS PERMANENTES DE PROCESO

- Escritorio pregunta estado Apple Build 17 en CADA sesion
- Verificar Supabase ANTES de aprobar subida a Play Console
- Backup AAB siempre fuera de android/app/build/
- CODE no compila sin instruccion explicita de Escritorio
- CODE pasa diff completo antes de cada commit
- Escritorio verifica diff en GitHub antes de aprobar
