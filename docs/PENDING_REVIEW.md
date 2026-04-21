# PENDING REVIEW — Fix calcularPulse() fallback BTC/ETH

**Archivo**: server.js, función `calcularPulse()` L859-878

---

## Problema
`calcularPulse()` llama Binance directo para BTC y ETH. Binance falla en Railway → btcPct=0, ethPct=0, btc90dPos=null. El Pulse se calcula incompleto AHORA MISMO en producción.

## Fix
En el catch de Binance (L878), en vez de dejar btcPct=0:
- Llama a CryptoCompare `pricemultifull` que devuelve `CHANGEPCT24HOUR`
- Usa la misma API key y el mismo `_ccIncrement(1)`
- Si CC también falla → ahí sí btcPct=0 (doble catch)

**ANTES:**
```js
} catch(e) { raw.btcPct = 0; raw.ethPct = 0; }
```

**DESPUÉS:**
```js
} catch(e) {
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
```

También agregué `AbortSignal.timeout(5000)` a los 3 fetch de Binance en la misma función (no tenían timeout).

## Lo que NO recupera el fallback
- `btc90dPos` (posición en rango 90 días) → requiere klines históricos que CC no da en esta llamada → queda null
- `btcMom30` (momentum 30 días) → ídem → queda null

Estos 2 campos son complementarios del Pulse, no críticos. El Pulse funciona sin ellos.

## Impacto en calls CC
+1 call cada 5 min (cron calcularPulse) = +288/día = +8.640/mes adicionales.

---

## Verificación
- `node -c server.js` → OK
- Solo toca server.js — no toca nativa ni PWA
