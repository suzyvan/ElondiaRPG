// 把玩家回報的程式錯誤（錯誤泡泡「詳細」裡的「出錯的地方」）對回原始碼的檔名與行號。
//
// 線上版的程式是壓縮過的（assets/index-xxxx.js:1:23456），要先在「玩家那個版本」的提交上建一份帶 source map 的建置：
//   git checkout v0.6.8
//   npx vite build --sourcemap hidden --outDir /tmp/elondia-map --emptyOutDir
// 同一份原始碼建出來的程式完全一樣（檔名的雜湊也一樣），只是多了 .map 檔。接著把整段訊息貼進來：
//   node tools/stack/mapstack.mjs /tmp/elondia-map < 回報.txt
// 每一行「assets/檔名.js:行:欄」後面會補上「→ src/…:行:欄（原本的名字）」。找不到 .map 的檔（版本不對）會寫出來。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('用法：node tools/stack/mapstack.mjs <建置的資料夾> < 回報.txt')
  process.exit(1)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function vlq(str) {
  const out = []
  let value = 0
  let shift = 0
  for (const ch of str) {
    const d = B64.indexOf(ch)
    value += (d & 31) << shift
    if (d & 32) shift += 5
    else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1)
      value = 0
      shift = 0
    }
  }
  return out
}

/** 解出 mappings：每一行生成的程式 → [生成的欄, 來源, 原本的行, 原本的欄, 名字] 的陣列 */
function decode(map) {
  const lines = []
  let src = 0, line = 0, col = 0, name = 0
  for (const row of map.mappings.split(';')) {
    const segs = []
    let gen = 0
    for (const seg of row.split(',')) {
      if (!seg) continue
      const v = vlq(seg)
      gen += v[0]
      if (v.length >= 4) {
        src += v[1]; line += v[2]; col += v[3]
        if (v.length >= 5) name += v[4]
        segs.push([gen, src, line, col, v.length >= 5 ? name : -1])
      }
    }
    lines.push(segs)
  }
  return lines
}

const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const path = join(dir, 'assets', `${file}.map`)
  const map = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
  const entry = map ? { map, lines: decode(map) } : undefined
  cache.set(file, entry)
  return entry
}

function lookup(file, line, column) {
  const m = load(file)
  if (!m) return `（找不到 ${file}.map：建置的版本和玩家的不一樣？）`
  const segs = m.lines[line - 1] ?? []
  let best
  for (const s of segs) if (s[0] <= column - 1) best = s
  if (!best) return '（對不到）'
  const source = m.map.sources[best[1]].replace(/^.*?\/(src|node_modules|data)\//, '$1/')
  const name = best[4] >= 0 ? `（${m.map.names[best[4]]}）` : ''
  return `${source}:${best[2] + 1}:${best[3] + 1}${name}`
}

const text = readFileSync(0, 'utf8')
for (const l of text.split('\n')) {
  const hit = l.match(/assets\/([\w.-]+\.js):(\d+):(\d+)/)
  console.log(hit ? `${l}  → ${lookup(hit[1], Number(hit[2]), Number(hit[3]))}` : l)
}
