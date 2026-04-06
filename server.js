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
app.get('/api/usuario/:userId', async (req, res) => { const { data, error } = await supabase.from('usuarios').select('*').eq('id', req.params.userId).single(); error ? res.status(404).json({ error }) : res.json(data); });
app.post('/api/usuario', async (req, res) => { const { data: ex } = await supabase.from('usuarios').select('*').eq('email', req.body.email).single(); if (ex) return res.json(ex); const { data, error } = await supabase.from('usuarios').insert({ ...req.body, plan: req.body.plan || 'FREE', created_at: new Date().toISOString() }).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.patch('/api/usuario/:userId', async (req, res) => { const { data, error } = await supabase.from('usuarios').update(req.body).eq('id', req.params.userId).select().single(); error ? res.status(500).json({ error }) : res.json(data); });
app.post('/api/test-telegram', async (req, res) => { try { await bot.sendMessage(req.body.chat_id, req.body.mensaje || '✅ Aurex Bot conectado!'); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });
app.post('/api/test-whatsapp', async (req, res) => { try { const to = (req.body.numero||'').startsWith('+') ? req.body.numero : '+' + req.body.numero; await twilioClient.messages.create({ from: WHATSAPP_FROM, to: 'whatsapp:' + to, body: req.body.mensaje || '✅ Aurex WhatsApp conectado!' }); res.json({ ok: true }); } catch(e) { res.status(400).json({ error: e.message }); } });

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
  if (rsi>70) motivos.push('RSI en zona de sobrecompra ('+rsi+')');
  else if (rsi<30) motivos.push('RSI en zona de sobreventa ('+rsi+')');
  else motivos.push('RSI en zona neutral ('+rsi+')');
  if (vr>1.5) motivos.push('Volumen superior al promedio ('+vr.toFixed(1)+'x)');
  else if (vr<0.6) motivos.push('Volumen bajo respecto al promedio');
  if (sc.macd>0.03) motivos.push('MACD en cruce alcista');
  else if (sc.macd<-0.03) motivos.push('MACD en cruce bajista');
  if (sc.soporte_resist>0.03) motivos.push('Precio cerca de soporte — posible rebote');
  else if (sc.soporte_resist<-0.03) motivos.push('Precio cerca de resistencia — posible rechazo');
  if (motivos.length < 3) motivos.push('Correlacion con mercado general ' + (sc.correlacion>0?'positiva':'negativa'));
  const escenario = dir==='ALTA CONV-IA' ? (al?'Ruptura alcista con alta conviccion':'Ruptura bajista con alta conviccion') : dir==='ALCISTA' ? 'Escenario alcista moderado' : 'Escenario bajista moderado';

  return { simbolo:sym, tipo, direccion:dir, scores:sc, confianza:pp, probPrincipal:pp, score:total, estrellas:est, rsi:parseFloat(rsi.toFixed(0)), volRel:parseFloat(vr.toFixed(1)), objetivo:d.precio>0?d.precio*(1+(al?mv:-mv)):0, stop:d.precio>0?d.precio*(1+(al?-mv*0.4:mv*0.4)):0, upside:(al?1:-1)*mv*100, precio:d.precio, precio24h:d.precio24h, prob_alcista:Math.round(probAlcista), prob_bajista:Math.round(probBajista), motivos:motivos.slice(0,5), escenario_principal:escenario };
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
            const d = await _fetchYahooIA(act.y);
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
  } catch(e) { console.error('[IA] Error:', e.message); }
}

// AUREX Pulse centralizado — misma fuente para PWA y nativa
let _pulseCache = { score: 50, label: 'NEUTRAL', updatedAt: null, details: {} };

async function calcularPulse() {
  try {
    // Mismas fuentes que la PWA: BTC, ETH, VIX, SP500, futuros, commodities
    const syms = ['^VIX','^GSPC','ES=F','NQ=F','YM=F','RTY=F','GC=F','SI=F','CL=F','HG=F'];
    const keys = ['vix','sp500','esf','nqf','ymf','rtyf','gcf','sif','clf','hgf'];
    const raw = {};

    // BTC y ETH de Binance
    const [btcR, ethR] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT').then(r=>r.json()),
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT').then(r=>r.json()),
    ]);
    raw.btcChg = parseFloat(btcR.priceChangePercent || 0);
    raw.ethChg = parseFloat(ethR.priceChangePercent || 0);
    raw.btcPrice = parseFloat(btcR.lastPrice || 0);

    // Klines 90d BTC para posición
    try {
      const kRes = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=90');
      const klines = await kRes.json();
      if (Array.isArray(klines) && klines.length > 10) {
        const closes = klines.map(k => parseFloat(k[4]));
        const min90 = Math.min(...closes);
        const max90 = Math.max(...closes);
        raw.btcPos90 = max90 > min90 ? ((raw.btcPrice - min90) / (max90 - min90)) * 100 : 50;
      }
    } catch(e) { raw.btcPos90 = 50; }

    // Yahoo data via nuestro propio proxy
    for (let i = 0; i < syms.length; i++) {
      try {
        const r = await _fetchYahooIA(syms[i]);
        if (r && r.precio && r.precio24h) {
          raw[keys[i]] = { price: r.precio, change: r.precio24h > 0 ? ((r.precio - r.precio24h) / r.precio24h) * 100 : 0 };
        }
      } catch(e) {}
    }

    // Calcular score GLOBAL (misma fórmula que la PWA)
    const pctToScore = (pct, scale) => Math.max(0, Math.min(100, 50 + pct * (scale || 5)));
    const vixToScore = (vix) => Math.max(0, Math.min(100, 100 - (vix - 10) * 3.0));

    let score = 0, weights = 0;

    // BTC Pos 90d (35%)
    if (raw.btcPos90 != null) { score += (raw.btcPos90) * 0.35; weights += 0.35; }
    // BTC momentum (15%)
    score += pctToScore(raw.btcChg, 3) * 0.15; weights += 0.15;
    // ETH momentum (8%)
    score += pctToScore(raw.ethChg, 3) * 0.08; weights += 0.08;
    // VIX (20%)
    if (raw.vix) { score += vixToScore(raw.vix.price) * 0.20; weights += 0.20; }
    // SP500 (8%)
    if (raw.sp500) { score += pctToScore(raw.sp500.change, 5) * 0.08; weights += 0.08; }
    // ES Fut (5%)
    if (raw.esf) { score += pctToScore(raw.esf.change, 5) * 0.05; weights += 0.05; }
    // Oro (5%)
    if (raw.gcf) { score += (50 - raw.gcf.change * 25) * 0.05; weights += 0.05; }
    // Petróleo (4%)
    if (raw.clf) { score += (50 - Math.abs(raw.clf.change) * 15) * 0.04; weights += 0.04; }

    const finalScore = weights > 0 ? Math.max(0, Math.min(100, Math.round(score / weights))) : 50;
    const label = finalScore <= 20 ? 'MIEDO EXTREMO' : finalScore <= 40 ? 'MIEDO' : finalScore <= 60 ? 'NEUTRAL' : finalScore <= 80 ? 'CODICIA' : 'CODICIA EXTREMA';

    _pulseCache = { score: finalScore, label, updatedAt: new Date().toISOString(), details: raw };
    console.log('[PULSE]', finalScore, label);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Aurex Backend:', PORT));