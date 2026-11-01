// 打聽、詢問時交給判定的「這一帶真的存在的東西」（<world_facts>）：附近的地點與路程、城裡的地標、附近出沒的怪物與弱點。
// 判定只能用這些地名與怪物（rumor 效果用這裡的 id），問到不存在的東西就讓對方不知道或記錯，不再編造新的地名。
// 只在想得到消息的行動附上（wantsWorldFacts），一般行動不花這些 token。見 docs/ACTIONS.md 的「打聽與傳聞」。

import type { ActionPending } from '@/engine/actions'
import { monsterLine } from '@/engine/bestiary'
import { DUNGEON_LAYER_IDS, DUNGEON_LAYER_NAME, enemies, geography, landmarks, locationById, regionById } from '@/engine/data'
import { nearbyPlaces } from '@/engine/intel'
import { ENEMY_KINDS } from '@/engine/mods'
import type { GameState } from '@/engine/types'
import { shortestPath } from '@/engine/world'
import { openFor } from '@/engine/storyFlags'

const TYPE_NAME: Record<string, string> = {
  capital: '王都', city: '城市', town: '城鎮', village: '村莊', port: '港口', outpost: '哨站', fortress: '要塞', dungeon: '地下城',
}

/** 最多列幾個地點、幾種怪物 */
const MAX_PLACES = 14
const MAX_MONSTERS = 30

/** 想得到消息的說法（繁簡都比對） */
const INFO_RE = /打聽|打听|詢問|询问|問|问|請教|请教|情報|情报|消息|傳聞|传闻|謠言|谣言|聽說|听说|弱點|弱点|哪裡|哪里|哪裏|在哪|位置|路線|路线|怎麼走|怎么走|地圖|地图|資料|资料|調查|调查|線索|线索|怪物|魔物|魔獸|魔兽|地下城|遺跡|遗迹/

/** 這次判定要不要附上 <world_facts>：聊天一律附（可能聽到消息），自由行動在描述像是要打聽消息時附 */
export function wantsWorldFacts(p: Pick<ActionPending, 'kind' | 'text'>): boolean {
  if (p.kind === 'chat') return true
  return p.kind === 'free' && INFO_RE.test(p.text ?? '')
}

export function worldFacts(state: GameState): string {
  const here = locationById(state.location)
  const region = regionById(here.region)
  const places = geography.locations
    .filter((l) => l.id !== here.id)
    .map((l) => ({ l, path: shortestPath(here.id, l.id, openFor(state)) }))
    .filter((x): x is { l: typeof x.l; path: NonNullable<typeof x.path> } => !!x.path && (x.l.region === here.region || x.path.days[1] <= 7))
    .sort((a, b) => a.path.days[0] - b.path.days[0])
    .slice(0, MAX_PLACES)
    .map(({ l, path }) => `- ${l.name} [${l.id}]｜${TYPE_NAME[l.type] ?? l.type}｜${regionById(l.region).name}｜${path.days[1] === 0 ? '就在附近' : `約 ${path.days[0] === path.days[1] ? path.days[0] : `${path.days[0]}～${path.days[1]}`} 天`}`)
  const marks = Object.values(landmarks).filter((l) => l.location === here.id).map((l) => l.name)

  // 怪物：附近（這裡的近郊、7 天內的地下城）每一層的遭遇表；淺的先列（各地下城的周邊、淺層比某一座的底層常被問到）
  const where = new Map<string, string[]>()
  for (const p of [...nearbyPlaces(here.id, openFor(state))].sort((a, b) => a.tier - b.tier)) {
    const label = p.layer ? `${locationById(p.location).name}・${DUNGEON_LAYER_NAME[p.layer]}` : `${locationById(p.location).name}近郊`
    for (const [m] of p.table.flat()) {
      const list = where.get(m) ?? []
      if (!list.includes(label)) list.push(label)
      where.set(m, list)
    }
  }
  const monsters = [...where.entries()].filter(([id]) => enemies[id]).slice(0, MAX_MONSTERS)
    .map(([id, at]) => `- ${monsterLine(enemies[id]!, (k) => ENEMY_KINDS[k] ?? k).replace(/^(\S+)/, `$1 [${id}]`)}｜出沒：${at.slice(0, 4).join('、')}`)

  return `<world_facts>
這一帶真的存在的地方與怪物。提到地點、地下城、怪物時，只能用這裡或世界書裡有的；對方不知道的事就說不知道、只知道大概的方向或記錯了，不要編造新的地名或怪物。玩家說的地點、說法和這裡不符時，以這裡為準（例如對方承認記錯，或那只是謠言）。[ ] 裡是 rumor 效果用的 id。
所在：${here.name} [${here.id}]（${region.name}・${TYPE_NAME[here.type] ?? here.type}）
${places.length ? `附近的地點（路程）：\n${places.join('\n')}` : ''}${marks.length ? `\n城裡的地標：${marks.join('、')}` : ''}
地下城的層：${DUNGEON_LAYER_IDS.map((l) => `${l}＝${DUNGEON_LAYER_NAME[l]}`).join('、')}
${monsters.length ? `附近出沒的怪物（怕＝弱點，抗＝抗性）：\n${monsters.join('\n')}` : '附近沒有記錄在案的怪物。'}
</world_facts>`
}
