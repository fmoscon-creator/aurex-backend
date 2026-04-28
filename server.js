require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const twilio = require('twilio');
const { generateAlertImage } = require('./alertImage');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

// EVOLUTION API (WhatsApp self-hosted) - primary WhatsApp sender
const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'aurex';
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP; // número admin en formato 5491167891320

async function sendWhatsAppEvolution(toNumber, text) {
  if (!EVOLUTION_URL || !EVOLUTION_KEY) throw new Error('Evolution API no configurado');
  const number = (toNumber || '').replace(/[^0-9]/g, '');
  if (!number) throw new Error('Número destino inválido');
  const r = await fetch(EVOLUTION_URL + '/message/sendText/' + EVOLUTION_INSTANCE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: JSON.stringify({ number, options: { delay: 1000, presence: 'composing' }, textMessage: { text } })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Evolution: ' + (d.response?.message?.join?.(', ') || d.error || r.status));
  return d;
}

async function sendWhatsAppImage(toNumber, imageBuffer, caption) {
  if (!EVOLUTION_URL || !EVOLUTION_KEY) throw new Error('Evolution API no configurado');
  const number = (toNumber || '').replace(/[^0-9]/g, '');
  if (!number) throw new Error('Número destino inválido');
  const base64 = imageBuffer.toString('base64');
  const r = await fetch(EVOLUTION_URL + '/message/sendMedia/' + EVOLUTION_INSTANCE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_KEY },
    body: JSON.stringify({
      number,
      options: { delay: 1000, presence: 'composing' },
      mediaMessage: {
        mediatype: 'image',
        media: base64,
        fileName: 'aurex-alert.png',
        mimetype: 'image/png',
        caption: caption || '',
      }
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Evolution Image: ' + (d.response?.message?.join?.(', ') || d.error || r.status));
  return d;
}

async function notifyAdmin(subject, body) {
  if (!ADMIN_WHATSAPP) return;
  try {
    const imgBuf = await generateAlertImage({ type: 'admin', message: subject + ' — ' + body });
    await sendWhatsAppImage(ADMIN_WHATSAPP, imgBuf, '🚨 ' + subject);
  } catch(imgErr) {
    console.error('[ADMIN Image]', imgErr.message, '— fallback a texto');
    try { await sendWhatsAppEvolution(ADMIN_WHATSAPP, '🚨 ' + subject + '\n\n' + body + '\n\n⏰ ' + new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })); }
    catch(e) { console.error('[ADMIN ALERT FAILED]', e.message); }
  }
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (msg.text === '/start') {
    bot.sendMessage(chatId, '🔶 Bienvenido a Aurex Alertas\n\nTu Chat ID es: ' + chatId + '\n\nCopialo en tu perfil de Aurex.', { parse_mode: 'Markdown' });
  } else if (msg.text === '/estado') {
    const { data } = await supabase.from('alertas').select('*').eq('telegram_chat_id', String(chatId)).eq('activa', true);
    bot.sendMessage(chatId, data && data.length ? data.map(a => '• ' + a.simbolo + ' $' + a.valor_objetivo).join('\n') : 'No tenés alertas activas.');
  } else {
    bot.sendMessage(chatId, 'Comandos: /start /estado');
  }
});

const ALPHA_KEY = process.env.ALPHA_VANTAGE_KEY;
const priceCache = {};

// ═══ FALLBACK SYSTEM — Auto-resolución SPEC v3 ═══
const COINGECKO_IDS = {
  BTC:'bitcoin',ETH:'ethereum',SOL:'solana',BNB:'binancecoin',XRP:'ripple',
  ADA:'cardano',AVAX:'avalanche-2',DOT:'polkadot',LINK:'chainlink',
  MATIC:'matic-network',DOGE:'dogecoin',SHIB:'shiba-inu',LTC:'litecoin',
  ATOM:'cosmos',UNI:'uniswap',NEAR:'near',APT:'aptos',ARB:'arbitrum',
  OP:'optimism',TRX:'tron',TON:'the-open-network',SUI:'sui',PEPE:'pepe',
  WIF:'dogwifcoin',FIL:'filecoin',INJ:'injective-protocol',RUNE:'thorchain',
  USDT:'tether',USDC:'usd-coin',
};
const cryptoCache = {};
const CRYPTO_CACHE_EMERGENCY_TTL = 1800000; // 30min
global._lastCryptoSource = 'binance';

// ── Contador CryptoCompare calls ──
let _ccCallsMonth = 0;
let _ccAlerted80k = false;
let _ccAlerted95k = false;
const CC_LIMIT = 100000;

async function _ccLoadCounter() {
  try {
    const { data } = await supabase.from('system_config').select('value,updated_at').eq('key', 'cc_monthly_calls').single();
    if (data) {
      const updMonth = new Date(data.updated_at).getMonth();
      const nowMonth = new Date().getMonth();
      if (updMonth === nowMonth) { _ccCallsMonth = parseInt(data.value) || 0; }
      else { _ccCallsMonth = 0; await _ccPersist(); }
    }
  } catch(e) { _ccCallsMonth = 0; }
  console.log('[CC] Counter loaded:', _ccCallsMonth);
}

async function _ccPersist() {
  try {
    await supabase.from('system_config').upsert({ key: 'cc_monthly_calls', value: String(_ccCallsMonth), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  } catch(e) { console.error('[CC] Persist error:', e.message); }
}

function _ccIncrement(count) {
  _ccCallsMonth += count;
  if (_ccCallsMonth % 50 < count) _ccPersist();
  if (!_ccAlerted80k && _ccCallsMonth >= CC_LIMIT * 0.8) {
    _ccAlerted80k = true;
    notifyAdmin('⚠️ CryptoCompare al 80%', 'Consumidas ' + _ccCallsMonth + ' de ' + CC_LIMIT + ' calls este mes.');
  }
  if (!_ccAlerted95k && _ccCallsMonth >= CC_LIMIT * 0.95) {
    _ccAlerted95k = true;
    notifyAdmin('🔴 CRITICO — CryptoCompare al 95%', 'Consumidas ' + _ccCallsMonth + ' de ' + CC_LIMIT + ' calls — riesgo de corte inminente.');
  }
}

// Reset el día 1 de cada mes a las 00:00 AR
cron.schedule('0 3 1 * *', async () => { // 03:00 UTC = 00:00 AR
  _ccCallsMonth = 0; _ccAlerted80k = false; _ccAlerted95k = false;
  await _ccPersist();
  console.log('[CC] Monthly counter reset');
});

setTimeout(_ccLoadCounter, 3000);

async function fetchCryptoPriceBatch(symbols) {
  const result = {};
  const now = Date.now();

  // 1. Binance batch (primaria)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const pairs = symbols.map(s => s + 'USDT');
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=' + JSON.stringify(pairs), { signal: ctrl.signal });
    clearTimeout(t);
    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) {
      data.forEach(p => {
        const sym = p.symbol.replace('USDT', '');
        result[sym] = { price: parseFloat(p.price), source: 'binance', stale: false, ts: now };
        cryptoCache[sym] = result[sym];
      });
      global._lastCryptoSource = 'binance';
      return result;
    }
  } catch(e) {}

  // 2. CryptoCompare batch (fallback 1 — 100k/mes)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const _ccHeaders = process.env.CRYPTOCOMPARE_KEY ? { 'authorization': 'Apikey ' + process.env.CRYPTOCOMPARE_KEY } : {};
    const r = await fetch('https://min-api.cryptocompare.com/data/pricemulti?fsyms=' + symbols.join(',') + '&tsyms=USD', { signal: ctrl.signal, headers: _ccHeaders });
    clearTimeout(t);
    const data = await r.json();
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      Object.keys(data).forEach(sym => {
        if (data[sym]?.USD) {
          result[sym] = { price: data[sym].USD, source: 'cryptocompare', stale: false, ts: now };
          cryptoCache[sym] = result[sym];
        }
      });
      global._lastCryptoSource = 'cryptocompare';
      _ccIncrement(1);
      if (_health.binance) mitigateAlert('binance', 'cryptocompare');
      return result;
    }
  } catch(e) {}

  // 3. Kraken batch (fallback 2 — gratuito sin key)
  try {
    const KRAKEN_MAP = {BTC:'XXBTZUSD',ETH:'XETHZUSD',XRP:'XXRPZUSD',LTC:'XLTCZUSD',DOGE:'XDGUSD'};
    const KRAKEN_SKIP = ['FTM','MKR','ROSE','THETA'];
    const krakenSyms = symbols.filter(s => !KRAKEN_SKIP.includes(s));
    if (krakenSyms.length > 0) {
      const pairs = krakenSyms.map(s => KRAKEN_MAP[s] || (s + 'USD')).join(',');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=' + pairs, { signal: ctrl.signal });
      clearTimeout(t);
      const data = await r.json();
      if (data && data.result && Object.keys(data.result).length > 0) {
        const reverseMap = {};
        krakenSyms.forEach(s => { reverseMap[KRAKEN_MAP[s] || (s + 'USD')] = s; });
        Object.keys(data.result).forEach(pair => {
          const sym = reverseMap[pair] || pair.replace('USD','').replace('XX','').replace('ZUSD','').replace('XDG','DOGE');
          const price = parseFloat(data.result[pair].c[0]);
          if (price > 0) {
            result[sym] = { price, source: 'kraken', stale: false, ts: now };
            cryptoCache[sym] = result[sym];
          }
        });
        if (Object.keys(result).length > 0) {
          global._lastCryptoSource = 'kraken';
          if (_health.binance) mitigateAlert('binance', 'kraken');
          return result;
        }
      }
    }
  } catch(e) {}

  // 4. CoinGecko batch (fallback 3 — 10k/mes gratuito) (fallback 2 — 10k/mes)
  try {
    const ids = symbols.map(s => COINGECKO_IDS[s]).filter(Boolean).join(',');
    if (ids) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd', { signal: ctrl.signal });
      clearTimeout(t);
      const data = await r.json();
      if (data && Object.keys(data).length > 0) {
        symbols.forEach(sym => {
          const id = COINGECKO_IDS[sym];
          if (id && data[id]?.usd) {
            result[sym] = { price: data[id].usd, source: 'coingecko', stale: false, ts: now };
            cryptoCache[sym] = result[sym];
          }
        });
        global._lastCryptoSource = 'coingecko';
        if (_health.binance) mitigateAlert('binance', 'coingecko');
        return result;
      }
    }
  } catch(e) {}

  // 5. Caché (último recurso)
  symbols.forEach(sym => {
    if (cryptoCache[sym]) {
      const age = now - cryptoCache[sym].ts;
      if (age < CRYPTO_CACHE_EMERGENCY_TTL) {
        result[sym] = {
          price: cryptoCache[sym].price, source: 'cache', stale: true,
          staleSince: cryptoCache[sym].ts, ageMinutes: Math.round(age / 60000), ts: cryptoCache[sym].ts
        };
      }
    }
  });
  global._lastCryptoSource = Object.keys(result).length > 0 ? 'cache' : 'none';
  return result;
}
async function getStockPrice(symbol) {
  const now = Date.now();
  if (priceCache[symbol] && (now - priceCache[symbol].ts) < 60000) return priceCache[symbol].data;
  try {
    const r = await fetch('https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=' + symbol + '&apikey=' + ALPHA_KEY);
    const json = await r.json();
    const q = json['Global Quote'];
    if (!q || !q['05. price']) return null;
    const data = { symbol, price: parseFloat(q['05. price']), changePct: parseFloat((q['10. change percent'] || '0').replace('%','')) };
    priceCache[symbol] = { ts: now, data };
    return data;
  } catch(e) { return null; }
}

async function generateAnalysis(simbolo, precio, contexto) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, messages: [{ role: 'user', content: 'Sos el motor IA de Aurex. Alerta: ' + simbolo + ' a $' + precio + '. ' + contexto + '. Análisis breve en español máx 4 líneas sin markdown.' }] })
    });
    const d = await r.json();
    return d.content?.[0]?.text || 'Análisis no disponible.';
  } catch(e) { return 'Análisis no disponible.'; }
}

async function dispararAlerta(alerta, precio) {
  await supabase.from('alertas').update({ disparada: true, disparada_at: new Date().toISOString(), precio_disparado: precio }).eq('id', alerta.id);
  const analisis = await generateAnalysis(alerta.simbolo, precio, 'objetivo $' + alerta.valor_objetivo + ' alcanzado');
  const emoji = precio >= (alerta.valor_objetivo || 0) ? '🟢' : '🔴';
  const ts = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  if (alerta.telegram_chat_id) {
    try { await bot.sendMessage(alerta.telegram_chat_id, emoji + ' ALERTA — ' + alerta.simbolo + '\n💰 $' + precio + '  🎯 $' + alerta.valor_objetivo + '\n\n' + analisis + '\n\n⏰ ' + ts, { parse_mode: 'Markdown' }); } catch(e) { console.error('TG:', e.message); }
  }
  if (alerta.whatsapp_numero) {
    const textBody = emoji + ' ALERTA — ' + alerta.simbolo + '\n💰 $' + precio + '  🎯 $' + alerta.valor_objetivo + '\n\n' + analisis + '\n\n⏰ ' + ts + '\n— Aurex';
    try {
      // Intentar enviar imagen generada
      const imgBuf = await generateAlertImage({
        type: 'precio',
        symbol: alerta.simbolo,
        direction: precio >= (alerta.valor_objetivo || 0) ? 'ALCISTA' : 'BAJISTA',
        price: precio,
        target: alerta.valor_objetivo,
      });
      const alertEmoji = precio >= (alerta.valor_objetivo || 0) ? '📈' : '📉';
      await sendWhatsAppImage(alerta.whatsapp_numero, imgBuf, alertEmoji + ' ' + alerta.simbolo + ' — $' + fmtP(precio) + '\n$' + fmtP(precio) + ' → $' + fmtP(alerta.valor_objetivo) + '\naurex.live');
    } catch(imgErr) {
      console.error('[WA Image]', imgErr.message, '— fallback a texto');
      // Fallback: enviar texto plano
      try { await sendWhatsAppEvolution(alerta.whatsapp_numero, textBody); }
      catch(e) {
        console.error('[WA Evolution]', e.message);
        try { const to = alerta.whatsapp_numero.startsWith('+') ? alerta.whatsapp_numero : '+' + alerta.whatsapp_numero; await twilioClient.messages.create({ from: WHATSAPP_FROM, to: 'whatsapp:' + to, body: textBody }); } catch(e2) { console.error('[WA Twilio fallback]', e2.message); }
      }
    }
  }
  await supabase.from('alertas_historial').insert({ alerta_id: alerta.id, simbolo: alerta.simbolo, precio_disparado: precio, analisis_ia: analisis, telegram_enviado: !!alerta.telegram_chat_id, whatsapp_enviado: !!alerta.whatsapp_numero, created_at: new Date().toISOString() });
}

async function checkAlertas() {
  try {
    const { data: alertas } = await supabase.from('alertas').select('*').eq('activa', true).eq('disparada', false);
    if (!alertas || !alertas.length) return;
    const cryptoSyms = [...new Set(alertas.filter(a => a.tipo_activo === 'cripto').map(a => a.simbolo))];
    let cp = {};
    if (cryptoSyms.length) {
      const cpResult = await fetchCryptoPriceBatch(cryptoSyms);
      Object.keys(cpResult).forEach(sym => { cp[sym] = cpResult[sym].price; });
    }
    for (const a of alertas) {
      const precio = a.tipo_activo === 'cripto' ? cp[a.simbolo] : (await getStockPrice(a.simbolo))?.price;
      if (!precio) continue;
      const ok = a.direccion === 'arriba' ? precio >= a.valor_objetivo : precio <= a.valor_objetivo;
      if (ok) await dispararAlerta(a, precio);
    }
  } catch(e) { console.error('checkAlertas:', e.message); }
}

cron.schedule('*/30 * * * * *', checkAlertas);

// Mantener cryptoCache siempre lleno (para /api/crypto-prices fallback)
async function refreshCryptoCache() {
  const cryptoSyms = IA_ACTIVOS.filter(a => a.t === 'Cripto' || a.t === 'Stable').map(a => a.s);
  if (cryptoSyms.length > 0) await fetchCryptoPriceBatch(cryptoSyms);
}
cron.schedule('*/2 * * * *', refreshCryptoCache); // cada 2 min
setTimeout(refreshCryptoCache, 5000); // al iniciar

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Aurex Backend', version: '1.0.0', time: new Date().toISOString() }));
app.get('/api/stock/:symbol', async (req, res) => { const d = await getStockPrice(req.params.symbol.toUpperCase()); d ? res.json(d) : res.status(404).json({ error: 'No encontrado' }); });
app.get('/api/alertas/:userId', async (req, res) => { const { data, error } = await supabase.from('alertas').select('*').eq('user_id', req.params.userId); error ? res.status(500).json({ error }) : res.json(data); });
app.post('/api/alertas', async (req, res) => { const { data, error } = await supabase.from('alertas').insert({ ...req.body, activa: true, disparada: false, created_at: new Date().toISOString() }).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.patch('/api/alertas/:id', async (req, res) => { const { data, error } = await supabase.from('alertas').update(req.body).eq('id', req.params.id).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.delete('/api/alertas/:id', async (req, res) => { const { error } = await supabase.from('alertas').delete().eq('id', req.params.id); error ? res.status(500).json({ error }) : res.json({ ok: true }); });
app.get('/api/portfolio/:userId', async (req, res) => {
  const { data, error } = await supabase.from('portfolio').select('*').eq('user_id', req.params.userId).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error });
  // Enriquecer con logo y ySymbol desde activos.json
  const enriched = (data || []).map(item => {
    const activo = IA_ACTIVOS.find(a => a.s === item.simbolo);
    return { ...item, logo: activo ? activo.logo : null, ySymbol: activo ? activo.y : item.simbolo };
  });
  res.json(enriched);
});
app.post('/api/portfolio', async (req, res) => { const { data, error } = await supabase.from('portfolio').insert({ ...req.body, created_at: new Date().toISOString() }).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.patch('/api/portfolio/:id', async (req, res) => { const { data, error } = await supabase.from('portfolio').update(req.body).eq('id', req.params.id).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.delete('/api/portfolio/:id', async (req, res) => { const { error } = await supabase.from('portfolio').delete().eq('id', req.params.id); error ? res.status(500).json({ error }) : res.json({ ok: true }); });
app.get('/api/watchlist/:userId', async (req, res) => { const { data, error } = await supabase.from('watchlist').select('*').eq('user_id', req.params.userId).order('orden'); error ? res.status(500).json({ error }) : res.json(data); });
app.post('/api/watchlist', async (req, res) => { const { data, error } = await supabase.from('watchlist').insert({ ...req.body, created_at: new Date().toISOString() }).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.delete('/api/watchlist/:id', async (req, res) => { const { error } = await supabase.from('watchlist').delete().eq('id', req.params.id); error ? res.status(500).json({ error }) : res.json({ ok: true }); });

// AVATAR upload — usa service_role key del backend para bypassar RLS del bucket
app.post('/api/avatar', async (req, res) => {
  try {
    const { user_id, base64, content_type } = req.body;
    if (!user_id || !base64) return res.status(400).json({ error: 'Faltan user_id o base64' });
    const buf = Buffer.from(base64, 'base64');
    const path = `${user_id}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, buf, { contentType: content_type || 'image/jpeg', upsert: true });
    if (upErr) return res.status(500).json({ error: upErr.message });
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    res.json({ url: `${urlData.publicUrl}?t=${Date.now()}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// WATCHLISTS v2 (tablas watchlists + watchlist_items)
app.get('/api/watchlists/:userId', async (req, res) => {
  const { data, error } = await supabase.from('watchlists').select('*').eq('user_id', req.params.userId).order('position', { ascending: true });
  error ? res.status(500).json({ error }) : res.json(data || []);
});
app.get('/api/watchlists/:userId/items', async (req, res) => {
  const { data: lists } = await supabase.from('watchlists').select('id').eq('user_id', req.params.userId);
  if (!lists || lists.length === 0) return res.json({});
  const result = {};
  for (const l of lists) {
    const { data: items } = await supabase.from('watchlist_items').select('*').eq('watchlist_id', l.id).order('position', { ascending: true });
    result[l.id] = items || [];
  }
  res.json(result);
});
app.post('/api/watchlists', async (req, res) => { const { data, error } = await supabase.from('watchlists').insert(req.body).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.post('/api/watchlist-items', async (req, res) => { const { data, error } = await supabase.from('watchlist_items').insert(req.body).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.delete('/api/watchlists/:id', async (req, res) => { await supabase.from('watchlist_items').delete().eq('watchlist_id', req.params.id); const { error } = await supabase.from('watchlists').delete().eq('id', req.params.id); error ? res.status(500).json({ error }) : res.json({ ok: true }); });
app.delete('/api/watchlist-items/:id', async (req, res) => { const { error } = await supabase.from('watchlist_items').delete().eq('id', req.params.id); error ? res.status(500).json({ error }) : res.json({ ok: true }); });
app.patch('/api/watchlist-items/:id', async (req, res) => { const { data, error } = await supabase.from('watchlist_items').update(req.body).eq('id', req.params.id).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.patch('/api/watchlists/:id', async (req, res) => { const { data, error } = await supabase.from('watchlists').update(req.body).eq('id', req.params.id).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.get('/api/usuario/:userId', async (req, res) => { const { data, error } = await supabase.from('usuarios').select('*').eq('id', req.params.userId).single(); error ? res.status(404).json({ error }) : res.json(data); });
app.post('/api/usuario', async (req, res) => { const { data: ex } = await supabase.from('usuarios').select('*').eq('email', req.body.email).single(); if (ex) return res.json(ex); const { data, error } = await supabase.from('usuarios').insert({ ...req.body, plan: req.body.plan || 'FREE', created_at: new Date().toISOString() }).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.patch('/api/usuario/:userId', async (req, res) => { const { data, error } = await supabase.from('usuarios').update(req.body).eq('id', req.params.userId).select().single(); error ? res.status(500).json({ error }) : res.json(data); });

// AUTH: proxy a Supabase auth desde Railway (evita issue de network fetch RN → Supabase directo)
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrbGxqbmZobHptZnNmbXhycGllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MzI3NDcsImV4cCI6MjA5MDEwODc0N30.FxegnijMue_K9jPqzY7gwNABaVpyyB6Io_ZkWLMSX9k';
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/test-telegram', async (req, res) => { try { await bot.sendMessage(req.body.chat_id, req.body.mensaje || '✅ Aurex Bot conectado!'); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });
app.post('/api/test-whatsapp', async (req, res) => { try { const to = (req.body.numero||'').startsWith('+') ? req.body.numero : '+' + req.body.numero; await twilioClient.messages.create({ from: WHATSAPP_FROM, to: 'whatsapp:' + to, body: req.body.mensaje || '✅ Aurex WhatsApp conectado!' }); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });

function fmtP(v) { if (!v || isNaN(v)) return '---'; return v >= 1000 ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v >= 1 ? v.toFixed(2) : v.toFixed(4); }

// WHATSAPP IMAGE - test endpoint
app.post('/api/whatsapp/test-image', async (req, res) => {
  try {
    const { numero, type, symbol, direction, probability, price, target, stop, message, pulseScore, pulseZone, pulseCrypto, pulseStocks, pulseCommod, pulseFutures, theme } = req.body || {};
    if (!numero) return res.status(400).json({ error: 'numero requerido' });
    const imgBuf = await generateAlertImage({ type: type || 'ia', symbol: symbol || 'BTC', direction: direction || 'ALCISTA', probability: probability || 82, price: price || 67450, target: target || 72846, stop: stop || 64752, message, pulseScore, pulseZone, pulseCrypto, pulseStocks, pulseCommod, pulseFutures, theme: theme || 'dark' });
    let caption = '';
    const t = type || 'ia';
    if (t === 'ia') {
      const dir = direction || 'ALCISTA';
      const dirEn = dir === 'ALCISTA' ? 'BULLISH' : dir === 'BAJISTA' ? 'BEARISH' : 'HIGH CONV';
      const dirEmoji = dir === 'ALCISTA' ? '📈' : dir === 'BAJISTA' ? '📉' : '⚡';
      caption = dirEmoji + ' ' + (symbol || 'BTC') + ' ' + dirEn + ' ' + (probability || 82) + '%\n🎯 Target $' + fmtP(target || 0) + '\naurex.live';
    } else if (t === 'precio') {
      const diffP = target && price ? ((price - target) / target * 100) : 0;
      const diffSign = diffP >= 0 ? '+' : '';
      caption = '🎯 ' + (symbol || '') + ' $' + fmtP(price || 0) + ' Now\n' + diffSign + diffP.toFixed(1) + '% of Target\naurex.live';
    } else if (t === 'pulse') {
      const pz = (pulseScore || 50) <= 20 ? 'Extreme Fear' : (pulseScore || 50) <= 40 ? 'Fear' : (pulseScore || 50) <= 60 ? 'Neutral' : (pulseScore || 50) <= 80 ? 'Greed' : 'Extreme Greed';
      caption = '💓 AUREX Pulse ' + (pulseScore || 50) + ' · ' + pz + '\nGlobal Market Sentiment\naurex.live';
    } else if (t === 'admin') {
      caption = '🚨 System Alert\naurex.live';
    }
    await sendWhatsAppImage(numero, imgBuf, caption);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// WHATSAPP EVOLUTION API - endpoint generic envío
app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { numero, mensaje } = req.body || {};
    if (!numero || !mensaje) return res.status(400).json({ error: 'numero y mensaje requeridos' });
    const d = await sendWhatsAppEvolution(numero, mensaje);
    res.json({ ok: true, id: d.key?.id, status: d.status });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Estado de conexión Evolution
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    if (!EVOLUTION_URL) return res.status(500).json({ error: 'Evolution no configurado' });
    const r = await fetch(EVOLUTION_URL + '/instance/connectionState/' + EVOLUTION_INSTANCE, { headers: { 'apikey': EVOLUTION_KEY } });
    const d = await r.json();
    res.json(d);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Crypto prices — expone cryptoCache para fallback de nativa y PWA cuando Binance falla
app.get('/api/crypto-prices', (req, res) => {
  const result = {};
  Object.keys(cryptoCache).forEach(sym => {
    if (cryptoCache[sym] && cryptoCache[sym].price) {
      result[sym] = { price: cryptoCache[sym].price, source: cryptoCache[sym].source || global._lastCryptoSource, ts: cryptoCache[sym].ts };
    }
  });
  res.json({ ok: true, source: global._lastCryptoSource, count: Object.keys(result).length, prices: result });
});

// Health status — estado actual de alertas (público, sin credenciales)
app.get('/api/health/status', async (req, res) => {
  try {
    const { data: events } = await supabase.from('health_events')
      .select('alert_id,type,status,message,triggered_at,resolved_at,duration_seconds,mitigated_at,mitigation_source')
      .order('triggered_at', { ascending: false })
      .limit(20);

    const activeFlags = {};
    for (const k of Object.keys(_health)) {
      if (_health[k]) activeFlags[k] = true;
    }

    // Últimos 7 reportes diarios
    const { data: dailyReports } = await supabase.from('daily_reports')
      .select('reported_at,resolved_count,active_count,total_count,report_text')
      .order('reported_at', { ascending: false })
      .limit(7);

    // Últimos 3 reportes mensuales
    const { data: monthlyReports } = await supabase.from('monthly_reports')
      .select('reported_at,month_label,total_incidents,resolved_count,active_count,report_text')
      .order('reported_at', { ascending: false })
      .limit(3);

    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      lastCryptoSource: global._lastCryptoSource || 'unknown',
      activeFlags,
      events: events || [],
      dailyReports: dailyReports || [],
      monthlyReports: monthlyReports || []
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Test daily report — fuerza envío manual del reporte diario
app.post('/api/health/test-report', async (req, res) => {
  try {
    await dailyHealthReport();
    res.json({ ok: true, message: 'Daily report sent + persisted' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Test monthly report — fuerza envío manual sin verificar último día hábil
app.post('/api/health/test-monthly', async function(req, res) {
  try {
    await _buildAndSendMonthlyReport();
    res.json({ ok: true, message: 'Monthly report sent + persisted' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Test admin
app.post('/api/test-admin-alert', async (req, res) => {
  try {
    await notifyAdmin(req.body?.subject || 'Test admin alert', req.body?.body || 'Esta es una prueba del canal de alertas admin.');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// YAHOO FINANCE PROXY - server side
const _yCache = {};
const _yTTL = 60000;

app.get('/api/yahoo', async (req, res) => {
  try {
    const sym = (req.query.symbol || '').toUpperCase();
    const iv = req.query.interval || '1d';
    const rng = req.query.range || '5d';
    if (!sym) return res.status(400).json({ error: 'symbol req' });
    const ck = sym + '_' + iv + '_' + rng;
    const now = Date.now();
    if (_yCache[ck] && (now - _yCache[ck].ts) < _yTTL) return res.json(_yCache[ck].data);
    const base = ['https://','query1.finance','.yahoo.com/v8/finance/chart/'].join('');
    const yUrl = base + sym + '?interval=' + iv + '&range=' + rng;
    const hdrs = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
    const r = await fetch(yUrl, { headers: hdrs });
    if (!r.ok) return res.status(r.status).json({ error: 'Yahoo ' + r.status });
    const data = await r.json();
    _yCache[ck] = { ts: now, data };
    res.json(data);
  } catch(e) { console.error('yproxy:', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/yahoo/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    if (!q) return res.status(400).json({ error: 'q req' });
    const sb = ['https://','query1.finance','.yahoo.com/v1/finance/search'].join('');
    const sq = sb + '?q=' + q + '&lang=en-US&newsCount=0&quotesCount=10';
    const sr = await fetch(sq, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
    if (!sr.ok) return res.status(sr.status).json({ error: 'YSearch ' + sr.status });
    res.json(await sr.json());
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── MOTOR IA CENTRALIZADO ───────────────────────────────────────────────────
// Calcula senales cada 5 min. PWA y app nativa leen de GET /api/ia-signals

// Lista unica de activos — fuente de verdad para todo el sistema
const IA_ACTIVOS = require('./activos.json').map(a => ({s:a.s, t:a.tipo, y:a.ySymbol||a.s, n:a.n, logo:a.logo||'', color:a.color||'#D4A017'}));
console.log('[IA] Activos cargados:', IA_ACTIVOS.length);

// Endpoint para consultar la lista de activos (PWA y app nativa)
app.get('/api/activos', (req, res) => res.json(IA_ACTIVOS));

function _calcRSI14(closes) {
  if (closes.length < 15) return 50;
  let g = 0, l = 0;
  for (let i = 1; i <= 14; i++) { const d = closes[i] - closes[i-1]; if (d > 0) g += d; else l -= d; }
  g /= 14; l /= 14;
  for (let i = 15; i < closes.length; i++) { const d = closes[i] - closes[i-1]; g = (g*13+(d>0?d:0))/14; l = (l*13+(d<0?-d:0))/14; }
  return l === 0 ? 100 : 100 - 100/(1+g/l);
}
function _ema(a, p) { let k=2/(p+1), e=a[0]; for(let i=1;i<a.length;i++) e=a[i]*k+e*(1-k); return e; }

async function _fetchBinanceIA(sym) {
  try {
    const [tR, kR] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbol='+sym+'USDT'),
      fetch('https://api.binance.com/api/v3/klines?symbol='+sym+'USDT&interval=1d&limit=16')
    ]);
    const t = await tR.json(), k = await kR.json();
    if (!t.lastPrice || !Array.isArray(k)) return null;
    const cls = k.map(x => parseFloat(x[4])).filter(x => x > 0);
    const vols = k.map(x => parseFloat(x[5])).filter(x => x > 0);
    const av = vols.length > 1 ? vols.slice(0,-1).reduce((a,b)=>a+b,0)/(vols.length-1) : vols[0]||1;
    return { precio:parseFloat(t.lastPrice), precio24h:parseFloat(t.prevClosePrice)||parseFloat(t.lastPrice), vol24h:parseFloat(t.volume)||0, volProm:av, hi:parseFloat(t.highPrice), lo:parseFloat(t.lowPrice), cls, hiMax:Math.max(...cls), loMin:Math.min(...cls) };
  } catch(e) { return null; }
}

// Fallback para motor IA — CryptoCompare histoday OHLCV (mapeo 9 campos verificado)
async function _fetchCryptoCompareIA(sym) {
  try {
    const _ccH = process.env.CRYPTOCOMPARE_KEY ? { 'authorization': 'Apikey ' + process.env.CRYPTOCOMPARE_KEY } : {};
    const [tickerR, histR] = await Promise.all([
      fetch('https://min-api.cryptocompare.com/data/pricemultifull?fsyms=' + sym + '&tsyms=USD', { signal: AbortSignal.timeout(5000), headers: _ccH }),
      fetch('https://min-api.cryptocompare.com/data/v2/histoday?fsym=' + sym + '&tsym=USD&limit=16', { signal: AbortSignal.timeout(5000), headers: _ccH })
    ]);
    _ccIncrement(2);
    const ticker = await tickerR.json();
    const hist = await histR.json();
    const t = ticker?.RAW?.[sym]?.USD;
    const klines = hist?.Data?.Data;
    if (!t || !Array.isArray(klines) || klines.length === 0) return null;
    const cls = klines.map(k => k.close).filter(x => x > 0);
    const vols = klines.map(k => k.volumefrom).filter(x => x > 0);
    const av = vols.length > 1 ? vols.slice(0, -1).reduce((a, b) => a + b, 0) / (vols.length - 1) : vols[0] || 1;
    return { precio: t.PRICE, precio24h: t.OPEN24HOUR, vol24h: t.VOLUME24HOUR, volProm: av, hi: t.HIGH24HOUR, lo: t.LOW24HOUR, cls, hiMax: Math.max(...cls), loMin: Math.min(...cls) };
  } catch(e) { return null; }
}

async function _fetchYahooIA(sym) {
  try {
    const base = ['https://','query1.finance','.yahoo.com/v8/finance/chart/'].join('');
    const hdrs = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
    const [r5, r30] = await Promise.all([
      fetch(base+sym+'?interval=1d&range=5d', {headers:hdrs}),
      fetch(base+sym+'?interval=1d&range=30d', {headers:hdrs})
    ]);
    const d5 = await r5.json(), d30 = await r30.json();
    const q5 = d5.chart.result[0], m = q5.meta;
    const c5 = (q5.indicators.quote[0].close||[]).filter(x=>x!=null);
    const v5 = (q5.indicators.quote[0].volume||[]).filter(x=>x!=null);
    const lc = c5[c5.length-1]||m.regularMarketPrice, pc = c5[c5.length-2]||lc;
    const av = v5.length>1 ? v5.slice(0,-1).reduce((a,b)=>a+b,0)/(v5.length-1) : v5[0]||1;
    const q30 = d30.chart.result[0];
    const c30 = (q30.indicators.quote[0].close||[]).filter(x=>x!=null);
    const h30 = (q30.indicators.quote[0].high||[]).filter(x=>x!=null);
    const l30 = (q30.indicators.quote[0].low||[]).filter(x=>x!=null);
    return { precio:lc, precio24h:pc, vol24h:v5[v5.length-1]||av, volProm:av, hi:m.regularMarketDayHigh||lc*1.02, lo:m.regularMarketDayLow||lc*0.98, cls:c30, hiMax:h30.length?Math.max(...h30):null, loMin:l30.length?Math.min(...l30):null };
  } catch(e) { return null; }
}

function _calcIAScore(tipo, sym, d) {
  const sc = {};
  const td = d.precio24h>0 ? (d.precio-d.precio24h)/d.precio24h : 0;
  sc.tendencia = td * 8;
  const rsi = d.cls && d.cls.length >= 15 ? _calcRSI14(d.cls) : Math.min(90, Math.max(10, 50+td*500));
  sc.rsi = rsi>70?-0.06 : rsi>60?0.04 : rsi<30?0.06 : rsi<40?-0.03 : 0.01;
  const vr = d.volProm>0 ? d.vol24h/d.volProm : 1;
  sc.volumen = vr>1.8&&td>0?0.06 : vr>1.8&&td<0?-0.06 : vr>1.3?(td>0?0.03:-0.03) : vr<0.6?-0.02 : 0.01;
  const vol = d.precio>0 ? (d.hi-d.lo)/d.precio : 0.02;
  sc.volatilidad = vol>0.06?-0.03 : vol>0.03?(td>0?0.02:-0.02) : 0.01;
  if (tipo==='cripto') { sc.correlacion = sym==='BTC' ? (d.btcC>0.01?0.03:d.btcC<-0.01?-0.03:0) : (d.btcC>0.02?0.04:d.btcC>0?0.02:d.btcC<-0.02?-0.04:-0.02); }
  else { sc.correlacion = d.spyC>0.01?0.03 : d.spyC<-0.01?-0.03 : 0; }
  let oro = 0;
  if (d.pOro>3000) oro = tipo==='metal'?0.04 : tipo==='cripto'?-0.02 : tipo==='bono'?0.02 : -0.02;
  else if (d.pOro>2200) oro = tipo==='metal'?0.03 : -0.01;
  if (d.pPet>90) oro += tipo==='materia_prima'?0.03 : -0.02;
  sc.oro_petroleo = oro;
  sc.macro = -0.03; sc.earnings = 0;
  let macd = 0;
  if (d.cls && d.cls.length >= 26) { const e12=_ema(d.cls.slice(-12),12), e26=_ema(d.cls.slice(-26),26), mp=e26>0?(e12-e26)/e26:0; macd = mp>0.005?0.05 : mp<-0.005?-0.05 : 0.01; }
  sc.macd = macd;
  let sr = 0;
  if (d.hiMax && d.loMin && d.precio>0) { const rp=(d.hiMax>d.loMin)?(d.precio-d.loMin)/(d.hiMax-d.loMin):0.5; sr = rp>0.85?-0.04 : rp<0.15?0.04 : rp>0.60?0.02 : -0.01; }
  sc.soporte_resist = sr;
  const total = Object.values(sc).reduce((a,b)=>a+b, 0);
  const cat = (rsi>70||rsi<30) || sc.volumen>0.12;
  const uc = cat?0.45:0.65, sa = Math.abs(total);
  let dir, pp;
  if (sa > uc) { dir='ALTA CONV-IA'; pp=Math.min(88, Math.round(55+sa*110)); }
  else if (total > 0.02) { dir='ALCISTA'; pp=Math.min(82, Math.round(52+total*220)); }
  else if (total < -0.02) { dir='BAJISTA'; pp=Math.min(82, Math.round(52+sa*220)); }
  else { dir=total>=0?'ALCISTA':'BAJISTA'; pp=Math.min(58, Math.round(50+sa*150)); }
  const est = sa>uc?5 : sa>0.10?4 : sa>0.06?3 : sa>0.03?2 : 1;
  const ml = tipo==='cripto'?{n:0.02,x:0.08} : tipo==='accion'?{n:0.01,x:0.04} : tipo==='bono'?{n:0.002,x:0.015} : {n:0.005,x:0.03};
  const ns = Math.min(sa,0.45)/0.45, mv = ml.n+ns*(ml.x-ml.n), al = total>0;
  // Campos adicionales para PWA y nativa
  const probAlcista = dir==='ALCISTA' ? pp : dir==='BAJISTA' ? (100-pp) : (al ? pp : 100-pp);
  const probBajista = 100 - probAlcista;
  // Motivos basados en variables más fuertes
  const motivos = [];
  if (Math.abs(sc.tendencia)>0.03) motivos.push(sc.tendencia>0 ? 'Tendencia alcista fuerte en 24h' : 'Tendencia bajista fuerte en 24h');
  if (rsi>70) motivos.push('RSI en zona de sobrecompra ('+Math.round(rsi)+')');
  else if (rsi<30) motivos.push('RSI en zona de sobreventa ('+Math.round(rsi)+')');
  else motivos.push('RSI en zona neutral ('+Math.round(rsi)+')');
  if (vr>1.5) motivos.push('Volumen superior al promedio ('+vr.toFixed(1)+'x)');
  else if (vr<0.6) motivos.push('Volumen bajo respecto al promedio');
  if (sc.macd>0.03) motivos.push('MACD en cruce alcista');
  else if (sc.macd<-0.03) motivos.push('MACD en cruce bajista');
  if (sc.soporte_resist>0.03) motivos.push('Precio cerca de soporte — posible rebote');
  else if (sc.soporte_resist<-0.03) motivos.push('Precio cerca de resistencia — posible rechazo');
  if (motivos.length < 3) motivos.push('Correlacion con mercado general ' + (sc.correlacion>0?'positiva':'negativa'));
  const escenario = dir==='ALTA CONV-IA' ? (al?'Ruptura alcista con alta conviccion':'Ruptura bajista con alta conviccion') : dir==='ALCISTA' ? 'Escenario alcista moderado' : 'Escenario bajista moderado';

  const objRaw = d.precio>0?d.precio*(1+(al?mv:-mv)):0;
  const stopRaw = d.precio>0?d.precio*(1+(al?-mv*0.4:mv*0.4)):0;
  const pDec = d.precio>=1000?2:d.precio>=1?2:d.precio>=0.01?4:d.precio>=0.0001?6:8;
  const precio7d = d.cls && d.cls.length >= 7 ? d.cls[d.cls.length - 7] : 0;
  const precio30d = d.cls && d.cls.length >= 30 ? d.cls[0] : 0;
  return { simbolo:sym, tipo, direccion:dir, scores:sc, confianza:pp, probPrincipal:pp, score:total, estrellas:est, rsi:parseFloat(rsi.toFixed(0)), volRel:parseFloat(vr.toFixed(1)), objetivo:parseFloat(objRaw.toFixed(pDec)), stop:parseFloat(stopRaw.toFixed(pDec)), upside:parseFloat(((al?1:-1)*mv*100).toFixed(1)), precio:d.precio, precio24h:d.precio24h, precio7d, precio30d, prob_alcista:Math.round(probAlcista), prob_bajista:Math.round(probBajista), motivos:motivos.slice(0,5), escenario_principal:escenario };
}

let _iaSignalsCache = { signals: [], updatedAt: null };

async function calcularSenalesIA() {
  console.log('[IA] Calculando senales para', IA_ACTIVOS.length, 'activos...');
  try {
    // Paso 1: datos de referencia (BTC, SPY, oro, petroleo)
    const [spyD, goldD, oilD, btcD] = await Promise.all([
      _fetchYahooIA('SPY'), _fetchYahooIA('GC=F'), _fetchYahooIA('CL=F'), _fetchYahooIA('BTC-USD')
    ]);
    const btcC = btcD&&btcD.precio24h>0 ? (btcD.precio-btcD.precio24h)/btcD.precio24h : 0;
    const spyC = spyD&&spyD.precio24h>0 ? (spyD.precio-spyD.precio24h)/spyD.precio24h : 0;
    const pOro = goldD ? goldD.precio : 2050;
    const pPet = oilD ? oilD.precio : 80;

    // Paso 2: procesar en batches de 10 para no saturar Yahoo
    const signals = [];
    for (let i = 0; i < IA_ACTIVOS.length; i += 10) {
      const batch = IA_ACTIVOS.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (act) => {
          try {
            let d = await _fetchYahooIA(act.y);
            if (!d || !d.precio) {
              // Fallback: CryptoCompare para crypto, null para stocks
              if (act.t === 'Cripto' || act.t === 'Stable') d = await _fetchCryptoCompareIA(act.s);
            }
            if (!d || !d.precio) return null;
            d.btcC = btcC; d.spyC = spyC; d.pOro = pOro; d.pPet = pPet;
            return _calcIAScore(act.t, act.s, d);
          } catch(e) { return null; }
        })
      );
      results.forEach(r => { if (r.status === 'fulfilled' && r.value) signals.push(r.value); });
      // Pausa entre batches para no ser bloqueado
      if (i + 10 < IA_ACTIVOS.length) await new Promise(r => setTimeout(r, 500));
    }
    signals.sort((a,b) => b.confianza - a.confianza);
    _iaSignalsCache = { signals, updatedAt: new Date().toISOString(), total: IA_ACTIVOS.length };
    const al = signals.filter(s=>s.direccion==='ALCISTA').length;
    const ba = signals.filter(s=>s.direccion==='BAJISTA').length;
    const hc = signals.filter(s=>s.direccion==='ALTA CONV-IA').length;
    console.log('[IA] Listo:', signals.length + '/' + IA_ACTIVOS.length, '|', al, 'alcistas', ba, 'bajistas', hc, 'alta conv');
    global._iaLastCalc = Date.now();
  } catch(e) { console.error('[IA] Error:', e.message); }
}

// AUREX Pulse centralizado — misma fuente para PWA y nativa
let _pulseCache = { scores: {}, raw: {}, updatedAt: null };

// === PULSE: funciones IDENTICAS a PWA aurex-features.js ===
function _pctToScore(pct, scale) { return Math.min(100, Math.max(0, 50 + (pct/scale)*50)); }
function _vixToScore(vix) { return Math.min(100, Math.max(0, 100 - (vix-10)*3.0)); }
function _goldToScore(pct) { return Math.min(100, Math.max(0, 50 - pct*25)); }
function _oilToScore(pct) { return Math.min(100, Math.max(0, 50 - Math.abs(pct)*15)); }

function _calcPulseScore(raw, cat) {
  if(!raw) return { value:50, label:'Neutral', color:'#D4A017', emoji:'😐', vars:{} };
  var scores = {}, weighted = 0, totalW = 0;
  function add(key, score, weight) {
    scores[key] = Math.round(score);
    weighted += score * weight;
    totalW += weight;
  }
  if(cat==='CRIPTO'||cat==='GLOBAL') {
    if(cat==='CRIPTO') {
      if(raw.btc90dPos !== null && raw.btc90dPos !== undefined) {
        add('BTC_Pos90d', raw.btc90dPos, 35);
      }
      if(raw.btcMom30 !== null && raw.btcMom30 !== undefined) {
        add('BTC_Mom30d', Math.min(100,Math.max(0,50+(raw.btcMom30/30)*50)), 15);
      } else {
        add('BTC_Mom1d', _pctToScore(raw.btcPct,6), 15);
      }
      if(raw.vix) add('VIX', _vixToScore(raw.vix.price), 20);
      if(raw.esf) add('SP500_Fut', _pctToScore(raw.esf.pct,1.5), 5);
    } else {
      add('BTC', _pctToScore(raw.btcPct,8), 12);
      add('ETH', _pctToScore(raw.ethPct,8), 8);
      if(raw.vix) add('VIX', _vixToScore(raw.vix.price), 14);
      if(raw.esf) add('SP500_Fut', _pctToScore(raw.esf.pct,1.5), 8);
    }
  }
  if(cat==='ACCIONES'||cat==='GLOBAL') {
    if(raw.vix)  add('VIX',    _vixToScore(raw.vix.price),   cat==='ACCIONES'?35:14);
    if(raw.sp500)add('SP500',  _pctToScore(raw.sp500.pct,1.5),cat==='ACCIONES'?25:8);
    if(raw.esf)  add('ES_Fut', _pctToScore(raw.esf.pct,1.5), cat==='ACCIONES'?20:8);
    if(raw.nqf)  add('NQ_Fut', _pctToScore(raw.nqf.pct,2),   cat==='ACCIONES'?12:6);
    if(raw.ymf)  add('YM_Fut', _pctToScore(raw.ymf.pct,1.5), cat==='ACCIONES'?8:4);
  }
  if(cat==='FUTUROS'||cat==='GLOBAL') {
    if(raw.esf)  add('ES_Fut',  _pctToScore(raw.esf.pct,1.5),  cat==='FUTUROS'?30:8);
    if(raw.nqf)  add('NQ_Fut',  _pctToScore(raw.nqf.pct,2),    cat==='FUTUROS'?25:6);
    if(raw.ymf)  add('YM_Fut',  _pctToScore(raw.ymf.pct,1.5),  cat==='FUTUROS'?20:4);
    if(raw.rtyf) add('RTY_Fut', _pctToScore(raw.rtyf.pct,2),   cat==='FUTUROS'?25:3);
  }
  if(cat==='COMOD'||cat==='GLOBAL') {
    if(raw.gcf) add('Oro',      _goldToScore(raw.gcf.pct), cat==='COMOD'?35:8);
    if(raw.sif) add('Plata',    _goldToScore(raw.sif.pct), cat==='COMOD'?20:4);
    if(raw.clf) add('Petroleo', _oilToScore(raw.clf.pct),  cat==='COMOD'?25:5);
    if(raw.hgf) add('Cobre',    _pctToScore(raw.hgf.pct,2),cat==='COMOD'?20:4);
  }
  if(cat !== 'CRIPTO') {
    if(raw.macro) add('Macro_FED', raw.macro.score, 12);
    if(raw.geo)   add('Geopolitica', raw.geo.score, 4);
  }
  if(totalW===0) return { value:50, label:'Neutral', vars:scores };
  var v = Math.min(100, Math.max(0, Math.round(weighted/totalW)));
  var label;
  if(v<=20)      label='Miedo Extremo';
  else if(v<=40) label='Miedo';
  else if(v<=60) label='Neutral';
  else if(v<=80) label='Codicia';
  else           label='Codicia Extrema';
  return { value:v, label:label, vars:scores };
}

async function calcularPulse() {
  try {
    const raw = {};
    // 1. BTC, ETH: Binance primero, fallback a cryptoCache (CC/Kraken/CoinGecko)
    try {
      const [btcR, ethR] = await Promise.all([
        fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', {signal: AbortSignal.timeout(5000)}).then(r=>r.json()),
        fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT', {signal: AbortSignal.timeout(5000)}).then(r=>r.json()),
      ]);
      raw.btcPct = parseFloat(btcR.priceChangePercent) || 0;
      raw.ethPct = parseFloat(ethR.priceChangePercent) || 0;
      // BTC 90-day range position
      try {
        const klines = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=90', {signal: AbortSignal.timeout(5000)}).then(r=>r.json());
        const cls = klines.map(k => parseFloat(k[4]));
        const hi90 = Math.max(...cls), lo90 = Math.min(...cls), cur = cls[cls.length-1];
        raw.btc90dPos = hi90>lo90 ? ((cur-lo90)/(hi90-lo90))*100 : 50;
        raw.btcMom30 = cls.length>=30 ? ((cur-cls[cls.length-30])/cls[cls.length-30])*100 : raw.btcPct;
      } catch(e) { raw.btc90dPos = null; raw.btcMom30 = null; }
    } catch(e) {
      // Fallback: CryptoCompare pricemultifull (tiene CHANGEPCT24HOUR)
      try {
        const _ccH = process.env.CRYPTOCOMPARE_KEY ? { 'authorization': 'Apikey ' + process.env.CRYPTOCOMPARE_KEY } : {};
        const ccR = await fetch('https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,ETH&tsyms=USD', { signal: AbortSignal.timeout(5000), headers: _ccH });
        const ccD = await ccR.json();
        _ccIncrement(1);
        raw.btcPct = ccD?.RAW?.BTC?.USD?.CHANGEPCT24HOUR || 0;
        raw.ethPct = ccD?.RAW?.ETH?.USD?.CHANGEPCT24HOUR || 0;
      } catch(e2) { raw.btcPct = 0; raw.ethPct = 0; }
      raw.btc90dPos = null; raw.btcMom30 = null;
    }

    // 2. Yahoo via nuestro propio proxy (idéntico a PWA)
    const yahooSyms = ['^VIX','^GSPC','ES=F','NQ=F','YM=F','RTY=F','GC=F','SI=F','CL=F','HG=F'];
    const yahooKeys = ['vix','sp500','esf','nqf','ymf','rtyf','gcf','sif','clf','hgf'];
    const BASE = process.env.RAILWAY_PUBLIC_DOMAIN ? ('https://' + process.env.RAILWAY_PUBLIC_DOMAIN) : 'http://localhost:' + (process.env.PORT || 3001);
    await Promise.all(yahooSyms.map(async (sym, idx) => {
      try {
        const url = BASE + '/api/yahoo?symbol=' + encodeURIComponent(sym) + '&interval=1d&range=2d';
        const res = await fetch(url);
        const data = await res.json();
        if(data.chart && data.chart.result && data.chart.result[0]) {
          const meta = data.chart.result[0].meta;
          const price = meta.regularMarketPrice || 0;
          const prev = meta.previousClose || meta.chartPreviousClose || price;
          raw[yahooKeys[idx]] = { price: price, pct: prev > 0 ? ((price-prev)/prev*100) : 0 };
        }
      } catch(e) { raw[yahooKeys[idx]] = { price: 0, pct: 0 }; }
    }));

    // 3. Macro FED (FRED) + Geopolitica (GDELT) — idéntico a PWA _fetchMacroGeo
    let macroScore = 50, geoScore = 70;
    try {
      const fredUrl = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS&limit=3&sort_order=desc';
      const fredText = await fetch(fredUrl).then(r => r.text());
      const lines = fredText.trim().split('\n').filter(l => l && l.indexOf('DATE') < 0);
      if (lines.length >= 2) {
        const r1 = parseFloat(lines[0].split(',')[1]) || 0;
        const r2 = parseFloat(lines[1].split(',')[1]) || 0;
        const delta = r1 - r2;
        macroScore = Math.min(100, Math.max(0, 50 - delta * 20));
      } else if (lines.length === 1) {
        const rate = parseFloat(lines[0].split(',')[1]) || 5;
        macroScore = Math.min(100, Math.max(0, 100 - (rate - 1) * 12));
      }
    } catch(e) {
      if (raw.vix && raw.vix.price) macroScore = Math.min(100, Math.max(0, 100 - (raw.vix.price - 10) * 2.5));
    }
    try {
      const gdeltUrl = 'https://api.gdeltproject.org/api/v2/summary/summary?d=aylook&t=summary&TIMESPAN=60&SRCLANG=english&OUTPUTTYPE=3';
      const gdeltData = await fetch(gdeltUrl).then(r => r.json());
      const tone = gdeltData && gdeltData.articles && gdeltData.articles[0] ? (parseFloat(gdeltData.articles[0].avgtone) || 0) : 0;
      geoScore = Math.min(100, Math.max(0, 50 + tone * 5));
    } catch(e) {
      if (raw.vix && raw.vix.price) geoScore = raw.vix.price > 30 ? Math.max(10, 70-(raw.vix.price-30)*3) : 70;
    }
    raw.macro = { score: Math.round(macroScore) };
    raw.geo = { score: Math.round(geoScore) };

     // 4. BTC Sentiment (solo Binance)
     try {
       const btcT = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT').then(r=>r.json());
       const priceChg = parseFloat(btcT.priceChangePercent);
       const volB = parseFloat(btcT.quoteVolume)/1e9;
       const avgRatio = parseFloat(btcT.weightedAvgPrice)/parseFloat(btcT.lastPrice);
       let sc = 50;
       sc += priceChg * 2.5;
       sc += (volB > 2 ? 5 : volB > 1 ? 2 : -3);
       sc += (avgRatio < 0.99 ? 8 : avgRatio > 1.01 ? -5 : 0);
       raw.btcSentiment = Math.max(0, Math.min(100, Math.round(sc)));
     } catch(e) { console.log("[PULSE] btcSentiment ERROR:", e.message); raw.btcSentiment = null; }

    // 5. Crypto Fear & Greed (Alternative.me) — idéntico a PWA
    try {
      const fngData = await fetch('https://api.alternative.me/fng/?limit=1').then(r=>r.json());
      raw.altFnG = fngData?.data?.[0]?.value != null ? parseInt(fngData.data[0].value) : null;
    } catch(e) { raw.altFnG = null; }

    // Calcular scores para las 5 categorías (idéntico a PWA _calcPulseScore)
    const CATS = ['GLOBAL', 'CRIPTO', 'ACCIONES', 'COMOD', 'FUTUROS'];
    const scores = {};
    CATS.forEach(cat => { scores[cat] = _calcPulseScore(raw, cat); });

    _pulseCache = { scores, raw, updatedAt: new Date().toISOString() };
    console.log('[PULSE] GLOBAL:', scores.GLOBAL.value, scores.GLOBAL.label, '| CRIPTO:', scores.CRIPTO.value, '| ACCIONES:', scores.ACCIONES.value, '| FUTUROS:', scores.FUTUROS.value, '| COMOD:', scores.COMOD.value);
  } catch(e) { console.error('[PULSE] Error:', e.message); }
}

calcularPulse();
cron.schedule('*/5 * * * *', calcularPulse);

app.get('/api/pulse', (req, res) => res.json(_pulseCache));

// Calcular al iniciar y cada 5 min
calcularSenalesIA();
cron.schedule('*/5 * * * *', calcularSenalesIA);

app.get('/api/ia-signals', (req, res) => res.json(_iaSignalsCache));
app.post('/api/ia-signals', (req, res) => {
  _iaSignalsCache = { signals: req.body || [], updatedAt: new Date().toISOString() };
  res.json({ ok: true, count: _iaSignalsCache.signals.length });
});

// ═══ HEALTH CHECK SYSTEM — alertas con ID, persistencia, reporte diario ═══
const _health = {};
const HEALTH_COOLDOWN = 15 * 60 * 1000;
const PREFIXES = { evolution: 'WA', supabase: 'DB', binance: 'BN', cryptocompare: 'CC', kraken: 'KR', cache: 'CA', ia_stale: 'IA', system: 'SYS' };

async function getNextAlertId(type) {
  const prefix = PREFIXES[type] || 'SYS';
  try {
    const { data } = await supabase.from('health_events').select('alert_id').eq('type', type).order('triggered_at', { ascending: false }).limit(1);
    if (data && data.length > 0) {
      const num = parseInt(data[0].alert_id.split('-')[1]) || 0;
      return prefix + '-' + String(num + 1).padStart(3, '0');
    }
  } catch(e) {}
  return prefix + '-001';
}

async function openAlert(type, message) {
  // Check if already active for this type
  const { data: existing } = await supabase.from('health_events').select('id').eq('type', type).eq('status', 'active').limit(1);
  if (existing && existing.length > 0) return null; // already active, skip

  const alertId = await getNextAlertId(type);
  const { data, error: insertErr } = await supabase.from('health_events').insert({
    alert_id: alertId, type, status: 'active', message, notified: false, resolution_notified: false
  }).select().single();
  if (insertErr || !data) { console.error('[HEALTH] Insert failed:', insertErr?.message); return null; }

  // Send WhatsApp
  const typeLabel = { evolution: 'Evolution WhatsApp', supabase: 'Supabase Database', binance: 'Binance API', cryptocompare: 'CryptoCompare API', cache: 'All Price Sources', ia_stale: 'AI Signals', system: 'System' }[type] || type;
  try {
    const imgBuf = await generateAlertImage({ type: 'admin', message: alertId + ' — ' + typeLabel + ' DOWN\n' + message, theme: 'dark' });
    await sendWhatsAppImage(ADMIN_WHATSAPP, imgBuf, '🚨 ALERT ' + alertId + ' — ' + typeLabel + ' DOWN\n' + new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }) + '\naurex.live');
  } catch(e) {
    // Fallback text
    try { await sendWhatsAppEvolution(ADMIN_WHATSAPP, '🚨 ALERT ' + alertId + ' — ' + typeLabel + ' DOWN\n' + message + '\n' + new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })); } catch(e2) {}
  }

  await supabase.from('health_events').update({ notified: true }).eq('id', data.id);
  console.log('[HEALTH] ALERT', alertId, typeLabel, 'DOWN:', message);
  return alertId;
}

async function resolveAlert(type) {
  const { data } = await supabase.from('health_events').select('*').eq('type', type).eq('status', 'active').limit(1);
  if (!data || data.length === 0) return;

  const evt = data[0];
  const resolvedAt = new Date();
  const triggeredAt = new Date(evt.triggered_at);
  const durationSec = Math.round((resolvedAt - triggeredAt) / 1000);
  const durStr = durationSec >= 60 ? Math.floor(durationSec / 60) + 'm ' + (durationSec % 60) + 's' : durationSec + 's';

  await supabase.from('health_events').update({
    status: 'resolved', resolved_at: resolvedAt.toISOString(), duration_seconds: durationSec,
    resolution_message: 'Service restored after ' + durStr
  }).eq('id', evt.id);

  const typeLabel = { evolution: 'Evolution WhatsApp', supabase: 'Supabase Database', binance: 'Binance API', cryptocompare: 'CryptoCompare API', cache: 'All Price Sources', ia_stale: 'AI Signals', system: 'System' }[type] || type;
  try {
    await sendWhatsAppEvolution(ADMIN_WHATSAPP, '✅ RESOLVED ' + evt.alert_id + ' — ' + typeLabel + ' OK\nDuration: ' + durStr + '\n' + resolvedAt.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }) + '\naurex.live');
  } catch(e) {}

  await supabase.from('health_events').update({ resolution_notified: true }).eq('id', evt.id);
  console.log('[HEALTH] RESOLVED', evt.alert_id, typeLabel, 'Duration:', durStr);
}

async function mitigateAlert(type, source) {
  const { data } = await supabase.from('health_events').select('*').eq('type', type).eq('status', 'active').is('mitigated_at', null).limit(1);
  if (!data || data.length === 0) return;
  const evt = data[0];
  const typeLabel = { evolution: 'Evolution WhatsApp', supabase: 'Supabase Database', binance: 'Binance API', cryptocompare: 'CryptoCompare API', cache: 'All Price Sources', ia_stale: 'AI Signals', system: 'System' }[type] || type;
  await supabase.from('health_events').update({ mitigated_at: new Date().toISOString(), mitigation_source: source }).eq('id', evt.id);
  try {
    await sendWhatsAppEvolution(ADMIN_WHATSAPP, '🟡 MITIGATED ' + evt.alert_id + ' — ' + typeLabel + ' DOWN, data OK via ' + source + '\n' + new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }) + '\naurex.live');
  } catch(e) { console.error('[HEALTH] Mitigate WA failed:', e.message); }
  console.log('[HEALTH] MITIGATED', evt.alert_id, 'via', source);
}

async function healthCheck() {
  // 1) Evolution WhatsApp
  try {
    if (EVOLUTION_URL) {
      const r = await fetch(EVOLUTION_URL + '/instance/connectionState/' + EVOLUTION_INSTANCE, { headers: { 'apikey': EVOLUTION_KEY } });
      const d = await r.json();
      if (d?.instance?.state !== 'open') {
        if (!_health.evolution) { _health.evolution = true; await openAlert('evolution', 'State: ' + (d?.instance?.state || 'unknown')); }
      } else if (_health.evolution) { _health.evolution = false; await resolveAlert('evolution'); }
    }
  } catch(e) {
    if (!_health.evolution) { _health.evolution = true; await openAlert('evolution', 'Connection error: ' + e.message); }
  }

  // 2) Supabase
  try {
    const { error } = await supabase.from('usuarios').select('id').limit(1);
    if (error) {
      if (!_health.supabase) { _health.supabase = true; await openAlert('supabase', 'Query error: ' + (error.message || 'unknown')); }
    } else if (_health.supabase) { _health.supabase = false; await resolveAlert('supabase'); }
  } catch(e) {
    if (!_health.supabase) { _health.supabase = true; await openAlert('supabase', 'Exception: ' + e.message); }
  }

  // 3) Binance (5s timeout) + mensajes diferenciados según fallback activo
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: ctrl.signal });
    clearTimeout(t);
    const d = await r.json();
    if (!d.price) throw new Error('No price');
    if (_health.binance) { _health.binance = false; await resolveAlert('binance'); }
    if (_health.cryptocompare) { _health.cryptocompare = false; await resolveAlert('cryptocompare'); }
    if (_health.cache) { _health.cache = false; await resolveAlert('cache'); }
  } catch(e) {
    // Binance falló — verificar fallbacks directamente
    let src = 'unknown';
    try {
      const r2 = await fetch('https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD', { signal: AbortSignal.timeout(5000) });
      const d2 = await r2.json();
      if (d2.USD) src = 'cryptocompare';
    } catch(_) {}
    if (src === 'unknown') {
      try {
        const r3 = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
        const d3 = await r3.json();
        if (d3.bitcoin?.usd) src = 'coingecko';
      } catch(_) {}
    }
    if (src === 'unknown' && cryptoCache['BTC']?.price) src = 'cache';
    if (src === 'unknown') src = 'none';

    global._lastCryptoSource = src;

    // --- Alerta Binance (BN) ---
    if (!_health.binance) {
      _health.binance = true;
      if (src === 'cryptocompare' || src === 'coingecko') {
        await openAlert('binance', 'DOWN — using ' + src + ' fallback. Data OK.');
      } else if (src === 'cache') {
        await openAlert('binance', 'ALL crypto sources DOWN. Serving cached data.');
      } else {
        await openAlert('binance', 'DOWN. Error: ' + e.message);
      }
    } else {
      if (src === 'cryptocompare' || src === 'coingecko') {
        await mitigateAlert('binance', src);
      }
      console.log('[HEALTH] Binance still down, lastSource:', src);
    }

    // --- Alerta CryptoCompare (CC) ---
    if (src === 'coingecko' || src === 'cache' || src === 'none') {
      if (!_health.cryptocompare) {
        _health.cryptocompare = true;
        if (src === 'coingecko') {
          await openAlert('cryptocompare', 'DOWN — using CoinGecko fallback. Data OK.');
        } else {
          await openAlert('cryptocompare', 'DOWN — no live fallback available.');
        }
      }
    } else if (src === 'cryptocompare' && _health.cryptocompare) {
      _health.cryptocompare = false;
      await resolveAlert('cryptocompare');
    }

    // --- Alerta Caché (CA) ---
    if (src === 'cache' || src === 'none') {
      if (!_health.cache) {
        _health.cache = true;
        if (src === 'cache') {
          await openAlert('cache', 'ALL live sources DOWN. Serving cached data (max 30min stale).');
        } else {
          await openAlert('cache', 'ALL sources DOWN. No data available.');
        }
      }
    } else if (_health.cache) {
      _health.cache = false;
      await resolveAlert('cache');
    }
  }

  // 4) IA signals stale (>10min)
  if (global._iaLastCalc && (Date.now() - global._iaLastCalc) > 600000) {
    if (!_health.ia_stale) { _health.ia_stale = true; await openAlert('ia_stale', 'Last calc ' + Math.round((Date.now() - global._iaLastCalc) / 60000) + ' min ago'); }
  } else if (_health.ia_stale) { _health.ia_stale = false; await resolveAlert('ia_stale'); }
}

// Daily report — 08:00 AM Argentina (11:00 UTC)
async function dailyHealthReport() {
  const now = new Date();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ═══ BLOQUE 1: CONEXIONES ACTUALES ═══
  let conns = '';

  conns += '✅ Railway Backend\n';

  try {
    const r = await fetch(EVOLUTION_URL + '/instance/connectionState/' + EVOLUTION_INSTANCE, { headers: { 'apikey': EVOLUTION_KEY } });
    const d = await r.json();
    conns += d?.instance?.state === 'open'
      ? '✅ Evolution API (state: open)\n'
      : '🔴 Evolution API (' + (d?.instance?.state || 'unknown') + ')\n';
  } catch(e) {
    conns += '🔴 Evolution API (Error: ' + e.message + ')\n';
  }

  try {
    const { error } = await supabase.from('usuarios').select('id').limit(1);
    conns += error
      ? '🔴 Supabase (Error: ' + error.message + ')\n'
      : '✅ Supabase\n';
  } catch(e) {
    conns += '🔴 Supabase (Error: ' + e.message + ')\n';
  }

  let binanceOk = false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: ctrl.signal });
    clearTimeout(t);
    const d = await r.json();
    if (d.price) binanceOk = true;
  } catch(e) {}

  if (binanceOk) {
    conns += '✅ Binance\n';
  } else {
    const src = global._lastCryptoSource || 'unknown';
    if (src === 'cryptocompare') {
      conns += '🟡 Binance → Fallback CryptoCompare OK\n';
    } else if (src === 'coingecko') {
      conns += '🟡 Binance → Fallback CoinGecko OK\n';
    } else if (src === 'cache') {
      conns += '🔴 Binance DOWN (sirviendo cache)\n';
    } else {
      conns += '🔴 Binance DOWN\n';
    }
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=' + ALPHA_KEY, { signal: ctrl.signal });
    clearTimeout(t);
    const d = await r.json();
    conns += d['Global Quote']?.['05. price']
      ? '✅ Alpha Vantage\n'
      : '🟡 Alpha Vantage (sin datos)\n';
  } catch(e) {
    conns += '🔴 Alpha Vantage (Error)\n';
  }

  // ═══ BLOQUE 2: INCIDENTES ÚLTIMAS 24H ═══
  const { data: events } = await supabase.from('health_events').select('*').gte('triggered_at', since).order('triggered_at', { ascending: false });

  const resolved = (events || []).filter(e => e.status === 'resolved');
  const active = (events || []).filter(e => e.status === 'active');
  const total = (events || []).length;

  const _meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  function _fmtAR(ts) {
    const d = new Date(new Date(ts).getTime() - 3 * 60 * 60 * 1000);
    return d.getDate() + '/' + _meses[d.getMonth()] + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  let incidents = '';

  if (total === 0) {
    incidents += '✅ No incidents in last 24h.\n';
  } else {
    if (resolved.length > 0) {
      resolved.slice(0, 6).forEach(e => {
        const trig = _fmtAR(e.triggered_at);
        const dur = e.duration_seconds >= 3600
          ? Math.floor(e.duration_seconds / 3600) + 'h ' + Math.floor((e.duration_seconds % 3600) / 60) + 'm'
          : e.duration_seconds >= 60
            ? Math.floor(e.duration_seconds / 60) + 'm ' + (e.duration_seconds % 60) + 's'
            : e.duration_seconds + 's';
        incidents += '✅ ' + e.alert_id + ' · ' + e.type + ' · ' + trig + ' · Duración: ' + dur + '\n';
      });
      if (resolved.length > 6) incidents += '... and ' + (resolved.length - 6) + ' more\n';
    }
    if (active.length > 0) {
      active.forEach(e => {
        const trig = _fmtAR(e.triggered_at);
        const elapsed = Math.round((now - new Date(e.triggered_at)) / 1000);
        const elStr = elapsed >= 3600
          ? Math.floor(elapsed / 3600) + 'h ' + Math.floor((elapsed % 3600) / 60) + 'm'
          : Math.floor(elapsed / 60) + 'm';
        const mitInfo = e.mitigated_at ? ' (mitigated via ' + e.mitigation_source + ')' : '';
        incidents += '🟡 ' + e.alert_id + ' · ' + e.type + ' · ' + trig + ' · Sin resolver: ' + elStr + mitInfo + '\n';
      });
    }
  }

  // ═══ ARMAR MENSAJE COMPLETO ═══
  let msg = '📊 AUREX Daily Health Report\n━━━━━━━━━━━━━━━━━━\n\n';
  msg += '🔌 CONEXIONES ACTUALES:\n' + conns + '\n';
  msg += '📊 CryptoCompare este mes: ' + _ccCallsMonth.toLocaleString() + ' / ' + CC_LIMIT.toLocaleString() + ' calls (' + Math.round(_ccCallsMonth/CC_LIMIT*100) + '%)\n\n';
  msg += '📋 INCIDENTES ÚLTIMAS 24H:\n' + incidents + '\n';
  if (total > 0) msg += 'Total: ' + resolved.length + ' resolved, ' + active.length + ' active\n';
  msg += '━━━━━━━━━━━━━━━━━━\naurex.live';

  // Persistir en Supabase
  try {
    await supabase.from('daily_reports').insert({
      reported_at: now.toISOString(),
      resolved_count: resolved.length,
      active_count: active.length,
      total_count: total,
      report_text: msg,
      events_snapshot: events || []
    });
  } catch(e) { console.error('[HEALTH REPORT] Persist failed:', e.message); }

  try { await sendWhatsAppEvolution(ADMIN_WHATSAPP, msg); } catch(e) { console.error('[HEALTH REPORT]', e.message); }
  console.log('[HEALTH] Daily report sent + persisted');
}

async function monthlyHealthReport() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = now.getDate();
  const dow = now.getDay();

  // Solo ejecutar el último día hábil del mes
  if (today === lastDay) {
    if (dow === 0 || dow === 6) return;
  } else if (today === lastDay - 1 && dow === 5) {
    // Viernes, mañana sábado es último día
  } else if (today === lastDay - 2 && dow === 5) {
    // Viernes, pasado domingo es último día
  } else {
    return;
  }

  await _buildAndSendMonthlyReport();
}

async function _buildAndSendMonthlyReport() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const _mesesLargo = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const monthLabel = _mesesLargo[now.getMonth()] + ' ' + now.getFullYear();

  const { data: events } = await supabase.from('health_events').select('*').gte('triggered_at', monthStart.toISOString()).order('triggered_at', { ascending: false });

  const allEvents = events || [];
  const resolved = allEvents.filter(e => e.status === 'resolved');
  const active = allEvents.filter(e => e.status === 'active');

  const { data: firstEvent } = await supabase.from('health_events')
    .select('triggered_at')
    .gte('triggered_at', monthStart.toISOString())
    .order('triggered_at', { ascending: true })
    .limit(1);

  const periodStart = firstEvent && firstEvent.length > 0
    ? new Date(firstEvent[0].triggered_at)
    : monthStart;
  const totalSeconds = Math.round((now - periodStart) / 1000);

  const serviceTypes = ['binance', 'cryptocompare', 'kraken', 'cache', 'evolution', 'supabase', 'ia_stale'];
  const services = {};

  serviceTypes.forEach(function(type) {
    const typeEvents = allEvents.filter(e => e.type === type);
    const typeResolved = typeEvents.filter(e => e.status === 'resolved');
    const typeActive = typeEvents.filter(e => e.status === 'active');

    var downtime = 0;
    var mitigatedTime = 0;

    typeResolved.forEach(function(e) {
      downtime += e.duration_seconds || 0;
      if (e.mitigated_at && e.resolved_at) {
        mitigatedTime += Math.round((new Date(e.resolved_at) - new Date(e.mitigated_at)) / 1000);
      }
    });

    typeActive.forEach(function(e) {
      var elapsed = Math.round((now - new Date(e.triggered_at)) / 1000);
      downtime += elapsed;
      if (e.mitigated_at) {
        mitigatedTime += Math.round((now - new Date(e.mitigated_at)) / 1000);
      }
    });

    var primaryPct = totalSeconds > 0 ? Math.max(0, Math.round(((totalSeconds - downtime) / totalSeconds) * 100)) : 100;
    var fallbackPct = totalSeconds > 0 ? Math.round((mitigatedTime / totalSeconds) * 100) : 0;

    services[type] = {
      incidents: typeEvents.length,
      resolved: typeResolved.length,
      active: typeActive.length,
      total_downtime_sec: downtime,
      total_mitigated_sec: mitigatedTime,
      primary_pct: primaryPct,
      fallback_pct: fallbackPct
    };
  });

  var _meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  function _fmtDay(ts) {
    var d = new Date(new Date(ts).getTime() - 3 * 60 * 60 * 1000);
    return d.getDate() + '/' + _meses[d.getMonth()];
  }
  function _fmtDur(sec) {
    if (sec >= 3600) return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
    if (sec >= 60) return Math.floor(sec / 60) + 'm ' + (sec % 60) + 's';
    return sec + 's';
  }

  var serviceLabels = {
    evolution: 'Evolution API',
    supabase: 'Supabase',
    binance: 'Binance',
    cryptocompare: 'CryptoCompare',
    kraken: 'Kraken',
    cache: 'Price Sources',
    ia_stale: 'IA Signals'
  };

  var msg = '📊 AUREX Monthly Report — ' + monthLabel + '\n━━━━━━━━━━━━━━━━━━\n\n';

  msg += '📈 RESUMEN:\n';
  msg += 'Total incidentes: ' + allEvents.length + '\n';
  msg += 'Resueltos: ' + resolved.length + ' · Activos: ' + active.length + '\n\n';

  msg += '🔌 UPTIME POR SERVICIO:\n';
  msg += '✅ Railway Backend · 100%\n';

  serviceTypes.forEach(function(type) {
    var s = services[type];
    var label = serviceLabels[type];
    if (s.incidents === 0) {
      msg += '✅ ' + label + ' · 100%\n';
    } else if (s.fallback_pct > 0) {
      msg += '🟡 ' + label + ' · ' + s.primary_pct + '% primaria · ' + s.fallback_pct + '% fallback\n';
    } else if (s.active > 0) {
      msg += '🔴 ' + label + ' · ' + s.primary_pct + '% uptime · ' + s.active + ' activo(s)\n';
    } else {
      msg += '✅ ' + label + ' · ' + s.primary_pct + '% uptime\n';
    }
  });

  msg += '✅ Alpha Vantage · 100%\n\n';

  if (allEvents.length > 0) {
    msg += '📋 INCIDENTES DEL MES:\n';
    allEvents.slice(0, 10).forEach(function(e) {
      var day = _fmtDay(e.triggered_at);
      if (e.status === 'resolved') {
        msg += '✅ ' + e.alert_id + ' · ' + day + ' · ' + _fmtDur(e.duration_seconds || 0) + '\n';
      } else {
        var elapsed = Math.round((now - new Date(e.triggered_at)) / 1000);
        var mitInfo = e.mitigated_at ? ' (mitigated via ' + e.mitigation_source + ')' : '';
        msg += '🟡 ' + e.alert_id + ' · ' + day + ' · ' + _fmtDur(elapsed) + '+' + mitInfo + '\n';
      }
    });
    if (allEvents.length > 10) msg += '... y ' + (allEvents.length - 10) + ' más\n';
    msg += '\n';
  }

  msg += '━━━━━━━━━━━━━━━━━━\naurex.live';

  try {
    await supabase.from('monthly_reports').insert({
      reported_at: now.toISOString(),
      month_label: monthLabel,
      report_text: msg,
      total_incidents: allEvents.length,
      resolved_count: resolved.length,
      active_count: active.length,
      services: services,
      events_snapshot: allEvents
    });
  } catch(e) { console.error('[MONTHLY REPORT] Persist failed:', e.message); }

  try { await sendWhatsAppEvolution(ADMIN_WHATSAPP, msg); } catch(e) { console.error('[MONTHLY REPORT]', e.message); }
  console.log('[MONTHLY] Report sent + persisted for', monthLabel);
}

async function restoreHealthState() {
  try {
    const { data } = await supabase.from('health_events').select('type').eq('status', 'active');
    if (data && data.length > 0) {
      data.forEach(function(evt) { _health[evt.type] = true; });
      console.log('[HEALTH] Restored active alerts:', data.map(function(e) { return e.type; }).join(', '));
    } else {
      console.log('[HEALTH] No active alerts to restore');
    }
  } catch(e) {
    console.error('[HEALTH] Restore failed:', e.message);
  }
}

// ============================================================
// DAILY_STATUS — endpoint, cron 20:00 AR, envio Telegram
// CACHE EN MEMORIA — se reinicia con cada redeploy de Railway.
// Tras redeploy los SHAs tardan hasta 15 min en actualizarse.
// ============================================================

const _shaCache = {};
const SHA_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

async function fetchLatestSha(repoFullName) {
  const cached = _shaCache[repoFullName];
  if (cached && Date.now() - cached.cachedAt < SHA_CACHE_TTL_MS) {
    return Object.assign({}, cached, { fromCache: true });
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(function(){ ctrl.abort(); }, 5000);
    const r = await fetch('https://api.github.com/repos/' + repoFullName + '/commits/main', { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error('GitHub API ' + r.status);
    const d = await r.json();
    const result = {
      sha: (d.sha || '').substring(0, 7),
      message: ((d.commit && d.commit.message) || '').split('\n')[0],
      date: d.commit && d.commit.author && d.commit.author.date,
      cachedAt: Date.now(),
      stale: false,
      fromCache: false
    };
    _shaCache[repoFullName] = result;
    return result;
  } catch (e) {
    if (cached) {
      return Object.assign({}, cached, { stale: true, fromCache: true, error: e.message });
    }
    return { sha: 'no-disponible', message: 'no se pudo obtener', error: e.message, stale: true, cachedAt: Date.now() };
  }
}

function formatTimeSince(submitDateStr, approvalDateStr) {
  if (!submitDateStr) return 'sin fecha de submit';
  if (approvalDateStr) {
    const d = new Date(approvalDateStr);
    return 'APROBADO el ' + d.toLocaleDateString('es-AR', {
      day: '2-digit', month: 'short', year: 'numeric',
      timeZone: 'America/Argentina/Buenos_Aires'
    });
  }
  const submit = new Date(submitDateStr);
  const now = new Date();
  const diffMs = now - submit;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return days + 'd ' + hours + 'h esperando aprobacion';
}

function buildStoresSection() {
  return {
    apple: {
      name: 'AUREX AI',
      build: process.env.APPLE_BUILD_NUMBER || '?',
      timeSince: formatTimeSince(process.env.APPLE_SUBMIT_DATE, process.env.APPLE_APPROVAL_DATE),
      submit: process.env.APPLE_SUBMIT_DATE
    },
    google: {
      name: 'AUREX',
      build: process.env.GOOGLE_BUILD_NUMBER || '?',
      timeSince: formatTimeSince(process.env.GOOGLE_SUBMIT_DATE, process.env.GOOGLE_APPROVAL_DATE),
      submit: process.env.GOOGLE_SUBMIT_DATE
    },
    source: 'env vars Railway'
  };
}

async function buildReposSection() {
  const r = await Promise.all([
    fetchLatestSha('fmoscon-creator/aurex-app'),
    fetchLatestSha('fmoscon-creator/aurex-backend')
  ]);
  const pwa = r[0], backend = r[1];
  function srcLabel(x) {
    if (x.fromCache) {
      const ageMin = Math.floor((Date.now() - x.cachedAt) / 60000);
      return 'GitHub API (cache, edad ~' + ageMin + ' min)' + (x.stale ? ' STALE' : '');
    }
    return 'GitHub API en vivo';
  }
  return {
    pwa: { sha: pwa.sha, message: pwa.message, stale: pwa.stale, source: srcLabel(pwa) },
    backend: { sha: backend.sha, message: backend.message, stale: backend.stale, source: srcLabel(backend) },
    nativa: {
      sha: process.env.AUREXAPP_LATEST_SHA || 'no-seteada',
      message: process.env.AUREXAPP_LATEST_SHA_DESC || '',
      source: 'env var AUREXAPP_LATEST_SHA (manual)'
    }
  };
}

async function buildIncidentsSection() {
  try {
    const q = await supabase
      .from('health_events')
      .select('alert_id, type, status, triggered_at, mitigated_at, mitigation_source')
      .eq('status', 'active')
      .order('triggered_at');
    if (q.error) throw q.error;
    return {
      activos: (q.data || []).map(function(e) {
        return {
          id: e.alert_id,
          type: e.type,
          triggered: e.triggered_at,
          mitigated: !!e.mitigated_at,
          mitigation_source: e.mitigation_source || null
        };
      }),
      source: 'Supabase health_events',
      ok: true
    };
  } catch (e) {
    return { activos: [], source: 'Supabase health_events', ok: false, error: 'Temporalmente no disponible' };
  }
}

function buildCryptoSection() {
  return {
    lastCryptoSource: global._lastCryptoSource || 'unknown',
    source: 'global._lastCryptoSource (memoria del proceso)'
  };
}

function buildPendingSection() {
  return {
    nota: 'Para pendientes actualizados ver: https://github.com/fmoscon-creator/aurex-app/blob/main/CONTEXTO.md',
    source: 'link al CONTEXTO.md'
  };
}

async function buildDailyStatus(format) {
  format = format || 'full';
  const stores = buildStoresSection();
  const r = await Promise.all([buildReposSection(), buildIncidentsSection()]);
  const repos = r[0], incidents = r[1];
  const crypto = buildCryptoSection();
  const pending = buildPendingSection();
  const generatedAt = new Date().toISOString();

  if (format === 'telegram') {
    let t = '';
    t += '📋 AUREX Daily Status\n';
    t += new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) + '\n';
    t += '━━━━━━━━━━━━━━━━━━\n\n';
    t += '🍎 APPLE: ' + stores.apple.name + ' Build ' + stores.apple.build + '\n   ' + stores.apple.timeSince + '\n\n';
    t += '🤖 GOOGLE: ' + stores.google.name + ' Build ' + stores.google.build + '\n   ' + stores.google.timeSince + '\n\n';
    t += '📦 REPOS\n';
    t += '   PWA: ' + repos.pwa.sha + (repos.pwa.stale ? ' (stale)' : '') + '\n';
    t += '   Nativa: ' + repos.nativa.sha + '\n';
    t += '   Backend: ' + repos.backend.sha + (repos.backend.stale ? ' (stale)' : '') + '\n\n';
    t += '⚠️ INCIDENTES ACTIVOS\n';
    if (incidents.ok) {
      if (incidents.activos.length === 0) t += '   ✅ Ninguno\n';
      else for (const a of incidents.activos) t += '   ' + a.id + ' ' + a.type + (a.mitigated ? ' (MITIGATED via ' + a.mitigation_source + ')' : '') + '\n';
    } else t += '   ' + incidents.error + '\n';
    t += '\n💱 Crypto source: ' + crypto.lastCryptoSource + '\n\n';
    t += '📌 Pendientes actualizados:\nhttps://github.com/fmoscon-creator/aurex-app/blob/main/CONTEXTO.md\n\n';
    t += 'aurex.live';
    return { content: t, generatedAt };
  }

  let t = '# AUREX DAILY STATUS\n';
  t += 'Generated at: ' + generatedAt + '\n\n';
  t += '## STORES\n';
  t += '- Apple: ' + stores.apple.name + ' Build ' + stores.apple.build + ' — ' + stores.apple.timeSince + '\n';
  t += '- Google: ' + stores.google.name + ' Build ' + stores.google.build + ' — ' + stores.google.timeSince + '\n';
  t += '- Source: ' + stores.source + '\n\n';
  t += '## REPOS\n';
  t += '- PWA aurex-app: ' + repos.pwa.sha + ' — ' + repos.pwa.message + '\n  Source: ' + repos.pwa.source + '\n';
  t += '- Nativa AurexApp: ' + repos.nativa.sha + ' — ' + repos.nativa.message + '\n  Source: ' + repos.nativa.source + '\n';
  t += '- Backend aurex-backend: ' + repos.backend.sha + ' — ' + repos.backend.message + '\n  Source: ' + repos.backend.source + '\n\n';
  t += '## INCIDENTES ACTIVOS\n';
  if (incidents.ok) {
    if (incidents.activos.length === 0) t += '- Ninguno\n';
    else for (const a of incidents.activos) t += '- ' + a.id + ' | type: ' + a.type + ' | triggered: ' + a.triggered + (a.mitigated ? ' | MITIGATED via ' + a.mitigation_source : '') + '\n';
  } else t += '- ' + incidents.error + '\n';
  t += 'Source: ' + incidents.source + '\n\n';
  t += '## CRYPTO\n- lastCryptoSource: ' + crypto.lastCryptoSource + '\n- Source: ' + crypto.source + '\n\n';
  t += '## PENDIENTES\n- ' + pending.nota + '\n- Source: ' + pending.source + '\n\n';
  t += 'aurex.live';
  return { content: t, generatedAt };
}

app.get('/api/daily-status', async (req, res) => {
  try {
    const format = req.query.format === 'telegram' ? 'telegram' : 'full';
    const result = await buildDailyStatus(format);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(result.content + '\n\n[generated_at: ' + result.generatedAt + ']');
  } catch (e) {
    res.status(200).send('AUREX DAILY STATUS — error al generar: ' + e.message + '\n[generated_at: ' + new Date().toISOString() + ']');
  }
});

async function dailyProjectStatusReport() {
  try {
    const result = await buildDailyStatus('telegram');
    const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
    if (!chatId) {
      console.error('[DAILY_STATUS] ADMIN_TELEGRAM_CHAT_ID no seteada');
      return;
    }
    await bot.sendMessage(chatId, result.content);
  } catch (e) {
    console.error('[DAILY_STATUS] Error en dailyProjectStatusReport:', e.message);
    try {
      const chatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
      if (chatId) await bot.sendMessage(chatId, '⚠️ DAILY_STATUS reporte 20:00 fallo: ' + e.message);
    } catch (e2) { /* silencioso si todo falla */ }
  }
}

app.post('/api/daily-status/test', async (req, res) => {
  try {
    await dailyProjectStatusReport();
    res.json({ ok: true, message: 'Reporte enviado a Telegram' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

restoreHealthState().then(() => {
  cron.schedule('*/5 * * * *', healthCheck);
  cron.schedule('0 11 * * *', dailyHealthReport); // 11:00 UTC = 08:00 Argentina
  cron.schedule('0 21 28-31 * *', monthlyHealthReport); // 21:00 UTC = 18:00 AR
  cron.schedule('0 23 * * *', dailyProjectStatusReport); // 23:00 UTC = 20:00 AR
  console.log('[HEALTH] Cron: check 5min + daily report 08:00 AR + project status 20:00 AR');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Aurex Backend:', PORT));