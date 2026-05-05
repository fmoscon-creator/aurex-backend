# AUREX — MASTER PENDIENTES — 5-MAY-2026

## PRIORIDAD 1 — BACKEND FIREBASE-ADMIN (URGENTE - DESBLOQUEADO)

Problema: No existe codigo de envio de push. Pruebas manuales desde Firebase Console con prioridad normal. Sin esto las alertas IA no disparan push a usuarios.

Falta: npm install firebase-admin, cargar service account JSON como env var en Railway, crear sendPushFCM con android priority high canal aurex_default, integrar en cron de alertas como tercer canal.

Service account JSON: ~/Downloads/aurex-app-8d985-firebase-adminsdk-fbsvc-f02d2b2a6c.json

## PRIORIDAD 2 — BUILD 7 ANDROID (URGENTE)

- Fix A: Race condition App.js — mover registerForPushNotifications a onAuthStateChange filtrando SIGNED_IN e INITIAL_SESSION
- Fix B: Error string fijo update-0-rows-or-error reemplazar por error real de Supabase
- Fix C: Barra termometro de riesgo se sale del limite derecho de la card en Android
- Fix D: Icono ojo en campo contrasena en pantalla de login (tambien aplica Build 18 iOS)
- Fix E (ya aplicado en Supabase 5-may): RLS politica INSERT usuarios WITH CHECK auth.uid() = id

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
