// ════════════════════════════════════════════════════════════════════
// AUREX API v1 — API personal para usuarios ELITE
// ════════════════════════════════════════════════════════════════════
// Fecha:   2-may-2026
// Módulo separado para no inflar server.js. Se monta vía app.use('/api/v1', router).
// Requiere migración: migrations/v1_api_keys_elite.sql ejecutada en Supabase.
//
// Auth flow:
//   1. Usuario logueado en PWA (con session token Supabase) llama
//      POST /api/v1/keys/generate → recibe key plaintext UNA SOLA VEZ.
//   2. Usuario usa la key como header `x-api-key: aurex_live_xxx` en
//      llamadas a /api/v1/signals, /api/v1/pulse, etc.
//   3. Middleware authenticateApiKey verifica hash, plan, rate limit.
//
// Rate limits por plan (rolling 24h):
//   FREE: 0 (no tienen acceso a la API personal)
//   PRO: 100 calls/día
//   ELITE: 1000 calls/día
// ════════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');

const RATE_LIMITS = { FREE: 0, PRO: 100, ELITE: 1000 };

function generateApiKey() {
  // Formato: aurex_live_<32 hex chars> (consistente con Stripe-style)
  const random = crypto.randomBytes(16).toString('hex');
  return `aurex_live_${random}`;
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function keyPrefix(key) {
  // Mostrar solo los primeros 14 chars + ... + últimos 4 (ej: aurex_live_a1b...c3d4)
  return `${key.substring(0, 14)}...${key.substring(key.length - 4)}`;
}

function makeRouter(supabase, _iaSignalsCacheRef, _pulseCacheRef) {
  const router = express.Router();

  // ───────────────────────────────────────────────────────────────────
  // Auth para gestión de keys: requiere session token de Supabase
  // (Authorization: Bearer <jwt>) — la PWA y la nativa lo tienen post-login.
  // ───────────────────────────────────────────────────────────────────
  async function authenticateUserSession(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.substring(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: 'Invalid session token' });
      req.user = user;
      // Buscar plan del usuario
      const { data: usr } = await supabase
        .from('usuarios')
        .select('plan, beta_access')
        .eq('id', user.id)
        .single();
      req.plan = (usr && usr.plan) || 'FREE';
      req.betaAccess = !!(usr && usr.beta_access);
      next();
    } catch (e) {
      res.status(500).json({ error: 'Auth error: ' + e.message });
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Auth para endpoints de datos: requiere x-api-key header
  // ───────────────────────────────────────────────────────────────────
  async function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'Missing x-api-key header' });

    const hash = hashApiKey(apiKey);
    const { data: keyRow, error } = await supabase
      .from('api_keys')
      .select('id, user_id, plan_at_creation, revoked_at')
      .eq('key_hash', hash)
      .single();

    if (error || !keyRow) return res.status(401).json({ error: 'Invalid API key' });
    if (keyRow.revoked_at) return res.status(401).json({ error: 'API key revoked' });

    // Buscar plan ACTUAL del user (puede haber cambiado desde que se creó la key)
    const { data: usr } = await supabase
      .from('usuarios')
      .select('plan')
      .eq('id', keyRow.user_id)
      .single();
    const currentPlan = (usr && usr.plan) || 'FREE';
    const limit = RATE_LIMITS[currentPlan] || 0;

    if (limit === 0) {
      return res.status(403).json({
        error: 'API access requires PRO or ELITE plan',
        current_plan: currentPlan
      });
    }

    // Rate limit: contar calls en últimas 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('api_usage')
      .select('id', { count: 'exact', head: true })
      .eq('api_key_id', keyRow.id)
      .gte('called_at', since);

    if ((count || 0) >= limit) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        plan: currentPlan,
        limit_24h: limit,
        used_24h: count
      });
    }

    req.apiKey = keyRow;
    req.plan = currentPlan;
    req.rateLimitRemaining = limit - (count || 0);

    // Logging async (no bloquea response)
    res.on('finish', async () => {
      try {
        await supabase.from('api_usage').insert({
          api_key_id: keyRow.id,
          endpoint: req.path,
          status_code: res.statusCode
        });
        await supabase
          .from('api_keys')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', keyRow.id);
      } catch (e) { /* silent */ }
    });

    next();
  }

  // ───────────────────────────────────────────────────────────────────
  // ENDPOINTS DE GESTIÓN DE KEYS (auth con session token)
  // ───────────────────────────────────────────────────────────────────

  // POST /api/v1/keys/generate
  // Body: { name?: string }
  // Response: { key: 'aurex_live_xxx...', id, prefix } (key se muestra solo aquí)
  router.post('/keys/generate', authenticateUserSession, async (req, res) => {
    if (req.plan === 'FREE') {
      return res.status(403).json({ error: 'API key generation requires PRO or ELITE plan' });
    }

    const key = generateApiKey();
    const hash = hashApiKey(key);
    const prefix = keyPrefix(key);
    const name = (req.body && req.body.name) || 'Default key';

    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        user_id: req.user.id,
        key_hash: hash,
        key_prefix: prefix,
        name,
        plan_at_creation: req.plan
      })
      .select('id, key_prefix, name, plan_at_creation, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      ...data,
      key,
      warning: 'Esta es la única vez que verás la key completa. Guardala en un lugar seguro. Si la perdés tenés que generar una nueva.'
    });
  });

  // GET /api/v1/keys/list
  router.get('/keys/list', authenticateUserSession, async (req, res) => {
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, key_prefix, name, plan_at_creation, created_at, last_used_at, revoked_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ keys: data });
  });

  // POST /api/v1/keys/revoke
  // Body: { id: 'uuid-de-la-key' }
  router.post('/keys/revoke', authenticateUserSession, async (req, res) => {
    const id = req.body && req.body.id;
    if (!id) return res.status(400).json({ error: 'Missing id in body' });

    const { error } = await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, revoked: id });
  });

  // ───────────────────────────────────────────────────────────────────
  // ENDPOINTS DE DATOS (auth con x-api-key)
  // ───────────────────────────────────────────────────────────────────

  // GET /api/v1/signals
  // Devuelve las 350 señales IA actuales
  router.get('/signals', authenticateApiKey, (req, res) => {
    const cache = _iaSignalsCacheRef();
    res.set('X-RateLimit-Remaining', String(req.rateLimitRemaining));
    res.json({
      total: cache.signals.length,
      updated_at: cache.updatedAt,
      signals: cache.signals
    });
  });

  // GET /api/v1/pulse
  // Devuelve los 5 scores del Pulse actual (CRIPTO, ACCIONES, FUTUROS, COMOD, GLOBAL).
  // Lee del cache global _pulseCache que el cron actualiza cada 5 min.
  router.get('/pulse', authenticateApiKey, (req, res) => {
    const cache = _pulseCacheRef();
    res.set('X-RateLimit-Remaining', String(req.rateLimitRemaining));
    res.json({
      updated_at: cache.updatedAt,
      scores: cache.scores
    });
  });

  // GET /api/v1/portfolio
  // Devuelve el portfolio del usuario asociado a la API key
  router.get('/portfolio', authenticateApiKey, async (req, res) => {
    const { data, error } = await supabase
      .from('portfolio')
      .select('*')
      .eq('user_id', req.apiKey.user_id);

    if (error) return res.status(500).json({ error: error.message });
    res.set('X-RateLimit-Remaining', String(req.rateLimitRemaining));
    res.json({ count: data.length, items: data });
  });

  // ───────────────────────────────────────────────────────────────────
  // ACCESO BETA — flag self-service para users que quieren probar features beta
  // ───────────────────────────────────────────────────────────────────

  // GET /api/v1/beta/status — devuelve si el user tiene beta_access activo
  router.get('/beta/status', authenticateUserSession, async (req, res) => {
    res.json({
      user_id: req.user.id,
      plan: req.plan,
      beta_access: req.betaAccess
    });
  });

  // POST /api/v1/beta/toggle — activa/desactiva beta_access del user
  // Body opcional: { enable: true|false } — si no viene, alterna el estado actual
  router.post('/beta/toggle', authenticateUserSession, async (req, res) => {
    const desired = req.body && typeof req.body.enable === 'boolean'
      ? req.body.enable
      : !req.betaAccess;

    const { error } = await supabase
      .from('usuarios')
      .update({ beta_access: desired })
      .eq('id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ user_id: req.user.id, beta_access: desired });
  });

  // GET /api/v1/health — sin auth, para verificar que la API está viva
  router.get('/health', (req, res) => {
    res.json({
      ok: true,
      service: 'AUREX API v1',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  });

  return router;
}

module.exports = { makeRouter, generateApiKey, hashApiKey };
