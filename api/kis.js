// Vercel Serverless Function for Korea Investment & Securities Open API
// Set KIS_APP_KEY and KIS_APP_SECRET in Vercel Project Settings > Environment Variables.

const KIS_BASE = process.env.KIS_BASE_URL || 'https://openapivts.koreainvestment.com:29443';
let tokenCache = { access_token: null, expires_at: 0 };

async function getToken() {
  if (tokenCache.access_token && Date.now() < tokenCache.expires_at) return tokenCache.access_token;
  const response = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.msg1 || 'KIS token request failed');
  tokenCache = { access_token: data.access_token, expires_at: Date.now() + ((data.expires_in || 86400) - 300) * 1000 };
  return data.access_token;
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const code = String(req.query.code || '005930').replace(/[^0-9]/g, '').slice(0, 6);
  if (code.length !== 6) return res.status(400).json({ error: '종목코드는 6자리 숫자여야 합니다.' });
  if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) return res.status(500).json({ error: 'KIS 환경변수가 설정되지 않았습니다.' });
  try {
    const token = await getToken();
    const headers = { authorization: `Bearer ${token}`, appkey: process.env.KIS_APP_KEY, appsecret: process.env.KIS_APP_SECRET, tr_id: 'FHKST01010100', custtype: 'P' };
    const quoteUrl = `${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`;
    const quoteResponse = await fetch(quoteUrl, { headers });
    const quote = await quoteResponse.json();
    if (!quoteResponse.ok || quote.rt_cd !== '0') throw new Error(quote.msg1 || 'KIS quote request failed');

    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 35);
    const chartHeaders = { ...headers, tr_id: 'FHKST03010100' };
    const chartParams = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code, FID_INPUT_DATE_1: yyyymmdd(start), FID_INPUT_DATE_2: yyyymmdd(end), FID_PERIOD_DIV_CODE: 'D', FID_ORG_ADJ_PRC: '0' });
    const chartResponse = await fetch(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${chartParams}`, { headers: chartHeaders });
    const chart = await chartResponse.json();
    if (!chartResponse.ok || chart.rt_cd !== '0') throw new Error(chart.msg1 || 'KIS chart request failed');

    const o = quote.output || {};
    const rows = (chart.output2 || []).filter(x => x.stck_bsop_date && x.stck_clpr).reverse();
    return res.status(200).json({ source: 'KIS', code, quote: { price: Number(o.stck_prpr || 0), changeRate: Number(o.prdy_ctrt || 0), open: Number(o.stck_oprc || 0), high: Number(o.stck_hgpr || 0), low: Number(o.stck_lwpr || 0), volume: Number(o.acml_vol || 0) }, chart: rows.map(x => ({ date: x.stck_bsop_date, close: Number(x.stck_clpr) })) });
  } catch (error) { return res.status(502).json({ error: error.message || 'KIS API 연결 실패' }); }
}
