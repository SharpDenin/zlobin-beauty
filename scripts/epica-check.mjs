const base = 'http://localhost:8090'
const login = await fetch(`${base}/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'master1@demo.local', password: 'Password123!' }),
})
const auth = await login.json()
if (!login.ok) {
  console.error('login', login.status, auth)
  process.exit(1)
}
const token = auth.access_token
const headers = { Authorization: `Bearer ${token}` }
async function get(path) {
  const res = await fetch(base + path, { headers })
  const data = await res.json()
  return { status: res.status, data }
}
const brand = await get('/v1/knowledge?brand=EPICA%20Professional&limit=1')
const color = await get('/v1/knowledge?brand=EPICA%20Professional&category=' + encodeURIComponent('Окрашивание и осветление') + '&limit=3')
const shade = await get('/v1/knowledge?q=COLORSHADE%207.1&limit=3')
const facets = await get('/v1/knowledge/facets')
const epicaBrands = (facets.data.brands || []).filter((b) => /epica/i.test(b.value))
console.log(JSON.stringify({
  brandTotal: brand.data.total,
  brandSample: brand.data.items?.[0]?.title,
  colorStatus: color.status,
  colorTotal: color.data.total,
  colorTitles: (color.data.items || []).map((i) => i.title),
  shade: (shade.data.items || []).map((i) => ({ title: i.title, category: i.category, cover: Boolean(i.cover_media_id) })),
  epicaBrands,
}, null, 2))
