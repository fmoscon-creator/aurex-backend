require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const twilio = require('twilio');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

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
    const to = alerta.whatsapp_numero.startsWith('+') ? alerta.whatsapp_numero : '+' + alerta.whatsapp_numero;
    try { await twilioClient.messages.create({ from: WHATSAPP_FROM, to: 'whatsapp:' + to, body: emoji + ' ALERTA — ' + alerta.simbolo + '\n💰 $' + precio + '  🎯 $' + alerta.valor_objetivo + '\n\n' + analisis + '\n\n⏰ ' + ts + '\n— Aurex IA' }); } catch(e) { console.error('WA:', e.message); }
  }
  await supabase.from('alertas_historial').insert({ alerta_id: alerta.id, simbolo: alerta.simbolo, precio_disparado: precio, analisis_ia: analisis, telegram_enviado: !!alerta.telegram_chat_id, whatsapp_enviado: !!alerta.whatsapp_numero, created_at: new Date().toISOString() });
}

async function checkAlertas() {
  try {
    const { data: alertas } = await supabase.from('alertas').select('*').eq('activa', true).eq('disparada', false);
    if (!alertas || !alertas.length) return;
    const cryptoSyms = [...new Set(alertas.filter(a => a.tipo_activo === 'cripto').map(a => a.simbolo + 'USDT'))];
    let cp = {};
    if (cryptoSyms.length) {
      try { const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=' + JSON.stringify(cryptoSyms)); (await r.json()).forEach(p => { cp[p.symbol.replace('USDT','')] = parseFloat(p.price); }); } catch(e) {}
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

app.get('/', (req, res) => res.json({ status: 'ok', app: 'Aurex Backend', version: '1.0.0', time: new Date().toISOString() }));
app.get('/api/stock/:symbol', async (req, res) => { const d = await getStockPrice(req.params.symbol.toUpperCase()); d ? res.json(d) : res.status(404).json({ error: 'No encontrado' }); });
app.get('/api/alertas/:userId', async (req, res) => { const { data, error } = await supabase.from('alertas').select('*').eq('user_id', req.params.userId); error ? res.status(500).json({ error }) : res.json(data); });
app.post('/api/alertas', async (req, res) => { const { data, error } = await supabase.from('alertas').insert({ ...req.body, activa: true, disparada: false, created_at: new Date().toISOString() }).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.patch('/api/alertas/:id', async (req, res) => { const { data, error } = await supabase.from('alertas').update(req.body).eq('id', req.params.id).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.delete('/api/alertas/:id', async (req, res) => { const { error } = await supabase.from('alertas').delete().eq('id', req.params.id); error ? res.status(500).json({ error }) : res.json({ ok: true }); });
app.get('/api/portfolio/:userId', async (req, res) => { const { data, error } = await supabase.from('portfolio').select('*').eq('user_id', req.params.userId); error ? res.status(500).json({ error }) : res.json(data); });
app.post('/api/portfolio', async (req, res) => { const { data, error } = await supabase.from('portfolio').insert({ ...req.body, created_at: new Date().toISOString() }).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.patch('/api/portfolio/:id', async (req, res) => { const { data, error } = await supabase.from('portfolio').update(req.body).eq('id', req.params.id).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.delete('/api/portfolio/:id', async (req, res) => { const { error } = await supabase.from('portfolio').delete().eq('id', req.params.id); error ? res.status(500).json({ error }) : res.json({ ok: true }); });
app.get('/api/watchlist/:userId', async (req, res) => { const { data, error } = await supabase.from('watchlist').select('*').eq('user_id', req.params.userId).order('orden'); error ? res.status(500).json({ error }) : res.json(data); });
app.post('/api/watchlist', async (req, res) => { const { data, error } = await supabase.from('watchlist').insert({ ...req.body, created_at: new Date().toISOString() }).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.delete('/api/watchlist/:id', async (req, res) => { const { error } = await supabase.from('watchlist').delete().eq('id', req.params.id); error ? res.status(500).json({ error }) : res.json({ ok: true }); });
app.get('/api/usuario/:userId', async (req, res) => { const { data, error } = await supabase.from('usuarios').select('*').eq('id', req.params.userId).single(); error ? res.status(404).json({ error }) : res.json(data); });
app.post('/api/usuario', async (req, res) => { const { data: ex } = await supabase.from('usuarios').select('*').eq('email', req.body.email).single(); if (ex) return res.json(ex); const { data, error } = await supabase.from('usuarios').insert({ ...req.body, plan: req.body.plan || 'FREE', created_at: new Date().toISOString() }).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.patch('/api/usuario/:userId', async (req, res) => { const { data, error } = await supabase.from('usuarios').update(req.body).eq('id', req.params.userId).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.post('/api/test-telegram', async (req, res) => { try { await bot.sendMessage(req.body.chat_id, req.body.mensaje || '✅ Aurex Bot conectado!'); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });
app.post('/api/test-whatsapp', async (req, res) => { try { const to = (req.body.numero||'').startsWith('+') ? req.body.numero : '+' + req.body.numero; await twilioClient.messages.create({ from: WHATSAPP_FROM, to: 'whatsapp:' + to, body: req.body.mensaje || '✅ Aurex WhatsApp conectado!' }); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log('🚀 Aurex Backend en puerto ' + PORT); console.log('📡 Alertas cada 30s'); console.log('🤖 Telegram + WhatsApp activos'); });