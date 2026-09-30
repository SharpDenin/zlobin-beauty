const url = process.argv[2] || 'https://epica-professional.com/catalog/product/516/'
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
const text = await res.text()
const out = process.argv[3] || 'scripts/epica-sample.html'
await import('node:fs').then((fs) => fs.writeFileSync(out, text))
console.log('wrote', out, text.length)
