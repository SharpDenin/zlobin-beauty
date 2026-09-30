const url = process.argv[2]
if (!url) {
  console.error('usage: node epica-fetch.mjs <url>')
  process.exit(1)
}
const res = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SalonXKnowledge/1.0)' },
})
const text = await res.text()
console.log('status', res.status, 'len', text.length)
const links = [...text.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
const uniq = [...new Set(links)].filter((h) => h.includes('catalog') || h.includes('upload') || h.includes('.jpg') || h.includes('.webp') || h.includes('.png'))
console.log(uniq.slice(0, 200).join('\n'))
