-- ════════════════════════════════════════════════════════════════════
-- Migración v1: API personal ELITE + Acceso beta
-- ════════════════════════════════════════════════════════════════════
-- Fecha:   2-may-2026
-- Estado:  PENDIENTE DE EJECUTAR (post-OK Fernando)
-- Cómo:    Supabase Dashboard → SQL Editor → New query → pegar todo este archivo → Run
-- Reversible: sí (DROP TABLE + ALTER DROP COLUMN al final)
-- Impacto en builds en revisión: CERO (solo agrega tablas/columnas, no modifica
--                                  estructura usada por Build 17 ni Build 2)
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Tabla api_keys ────────────────────────────────────────────────
-- Guarda HASH de la API key (nunca plaintext). El usuario ve la key una sola
-- vez al generarla; si la pierde tiene que regenerar otra.
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT,
  plan_at_creation TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT api_keys_plan_check CHECK (plan_at_creation IN ('FREE','PRO','ELITE'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON public.api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys(user_id);

-- ─── 2. Tabla api_usage (rate limiting 24h rolling counter) ──────────
CREATE TABLE IF NOT EXISTS public.api_usage (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  status_code INT NOT NULL,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_key_time ON public.api_usage(api_key_id, called_at DESC);

-- ─── 3. Acceso beta a usuarios ───────────────────────────────────────
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS beta_access BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── 4. Row Level Security (RLS) ─────────────────────────────────────
-- Los users solo ven/editan sus propias keys. El service_role bypasa todo.
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see only their own API keys" ON public.api_keys;
CREATE POLICY "Users see only their own API keys"
  ON public.api_keys FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert their own API keys" ON public.api_keys;
CREATE POLICY "Users insert their own API keys"
  ON public.api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update their own API keys" ON public.api_keys;
CREATE POLICY "Users update their own API keys"
  ON public.api_keys FOR UPDATE
  USING (auth.uid() = user_id);

ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see only their own API usage" ON public.api_usage;
CREATE POLICY "Users see only their own API usage"
  ON public.api_usage FOR SELECT
  USING (api_key_id IN (SELECT id FROM public.api_keys WHERE user_id = auth.uid()));

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (en caso de necesitar revertir):
-- ════════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS public.api_usage CASCADE;
-- DROP TABLE IF EXISTS public.api_keys CASCADE;
-- ALTER TABLE public.usuarios DROP COLUMN IF EXISTS beta_access;
-- ════════════════════════════════════════════════════════════════════
