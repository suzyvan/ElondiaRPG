import { afterEach, describe, expect, it } from 'vitest'
import { landmarks, stories } from '@/engine/data'
import { setContentFilters, setMascBodyContent } from '@/engine/content'
import { enterLocation, getArea, landmarkHidden, standOn } from '@/engine/grid'
import { npcRecord } from '@/engine/npcs'
import { peopleHere } from '@/engine/population'
import { guildQuests } from '@/engine/town'
import { sanitizeLandmarkMod, sanitizeScene } from '@/engine/landmarkMods'
import { enterLandmark, insideLandmark, interiorBlocked, landmarkHere, playLandmarkScene, sceneBlocked, sceneSpots, sceneText, scenesHere } from '@/engine/landmarks'
import { leaveSpecial } from '@/engine/specialMaps'
import { specialMapUsage } from '@/engine/specialMapMods'
import { ambushChance } from '@/engine/rest'
import { currentArea, currentCell } from '@/engine/grid'
import { applyContent, emptyMods, normalizeMods } from '@/engine/mods'
import { addItem, newGame } from '@/engine/state'
import { equipItem } from '@/engine/inventory'
import { pcOf } from '@/engine/party'
import { setFlag } from '@/engine/storyFlags'
import { startStory } from '@/engine/story'
import type { GameState } from '@/engine/types'

afterEach(() => {
  setContentFilters({ ntr: true })
  applyContent(emptyMods())
})

const AREAS = ['lm_wives_salon', 'lm_maid_cafe', 'lm_ebony_night', 'lm_succubus_banquet', 'lm_idol_backstage', 'lm_honor_hole']

function at(id: string, flags: string[], body?: 'masc' | 'fem' | 'andro'): GameState {
  const l = landmarks[id]!
  const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 4, birthplace: l.location, ...(body ? { body } : {}) })
  for (const f of flags) setFlag(state, f)
  state.time.hour = 21
  enterLocation(state)
  expect(standOn(state, id as never), id).toBe(true)
  enterLandmark(state)
  return state
}
/** 走到這個場景所在的那一格 */
function goTo(state: GameState, title: string) {
  const sc = landmarkHere(state)!.scenes!.find((x) => x.title === title)!
  state.position = { ...state.position!, x: sc.spot!.x, y: sc.spot!.y }
}
/** 內部每一格現在出現的場景（依地標上的順序） */
function titles(state: GameState): string[] {
  const l = landmarkHere(state)!
  const back = { ...state.position! }
  const seen = new Set<string>()
  for (const sc of l.scenes ?? []) {
    if (!sc.spot) continue
    state.position = { ...back, x: sc.spot.x, y: sc.spot.y }
    for (const x of scenesHere(state)) seen.add(x.scene.title)
  }
  state.position = back
  return (l.scenes ?? []).map((x) => x.title).filter((t) => seen.has(t))
}
const index = (state: GameState, title: string) => {
  goTo(state, title)
  return scenesHere(state).find((x) => x.scene.title === title)!.index
}

describe('special areas unlocked by the storylines', () => {
  it('are adult landmarks that stay a plain road until their quest flags are set', () => {
    for (const id of AREAS) {
      const l = landmarks[id]!
      expect(l.open?.hidden, id).toBe(true)
      expect(l.open?.adult, id).toBe(true)
      expect(l.open?.flags?.length, id).toBeGreaterThan(0)
      expect(l.scenes?.length, id).toBeGreaterThan(0)
      const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 4, birthplace: l.location })
      enterLocation(state)
      const cell = () => getArea(state, l.at.area).cells[l.at.y * getArea(state, l.at.area).width + l.at.x]!.kind
      expect(cell(), id).toBe('floor')
      for (const f of l.open!.flags!) setFlag(state, f)
      // 卡珊卓線的結局一定是戴著項圈或自由其中一個；沒有場景可選的地標不出現
      if (id === 'lm_succubus_banquet') setFlag(state, 'cas_free')
      expect(cell(), id).toBe(id)
    }
  })

  it('opens the tea parlour with Mimi and Eve; Ren and the closed-shop scene need her back on land', () => {
    const state = at('lm_maid_cafe', ['mimi_lover', 'eve_lover'])
    expect(titles(state)).toEqual(['在前廳喝茶', '和米米去小房間', '和伊芙去小房間'])
    const tea = landmarks.lm_maid_cafe!.scenes!.find((s) => s.title === '在前廳喝茶')!
    expect(sceneText(state, tea)).toContain('米米、伊芙')
    expect(sceneText(state, tea)).not.toContain('漣')
    setFlag(state, 'ren_lover')
    setFlag(state, 'ren_sea')
    expect(titles(state)).not.toContain('和漣去小房間')
    const land = at('lm_maid_cafe', ['mimi_lover', 'eve_lover', 'ren_lover', 'ren_land'])
    expect(titles(land)).toEqual(['在前廳喝茶', '和米米去小房間', '和伊芙去小房間', '和漣去小房間', '暫時關店，和三個人一起'])
  })

  it('lets you come back every three days, while tea at the front stays daily', () => {
    const state = at('lm_maid_cafe', ['mimi_lover', 'eve_lover'])
    state.time.hour = 10
    state.money_cc = 500
    const r = playLandmarkScene(state, index(state, '和米米去小房間'))
    expect(r.narration?.adult_scene).toContain('米米')
    expect(r.others?.map((o) => o.id)).toEqual(['npc_mimi'])
    expect(r.changes.affinity?.some((a) => a.npc === 'npc_mimi' && a.delta === 3)).toBe(true)
    expect(sceneBlocked(state, index(state, '和伊芙去小房間'))).toBe('3 天後才能再來')
    expect(sceneBlocked(state, index(state, '在前廳喝茶'))).toBeUndefined()
    const tea = playLandmarkScene(state, index(state, '在前廳喝茶'))
    expect(tea.narration?.adult_scene).toBeUndefined()
    expect(state.money_cc).toBe(470)
    expect(sceneBlocked(state, index(state, '在前廳喝茶'))).toBe('1 天後才能再來')
    state.time.day += 3
    expect(sceneBlocked(state, index(state, '和伊芙去小房間'))).toBeUndefined()
  })

  it('brings the twins, Lucia and Noel to the banquet only as lovers, and other succubi otherwise', () => {
    const collared = at('lm_succubus_banquet', ['cas_lover', 'cas_collared'])
    expect(titles(collared)).toEqual(['戴著項圈的女王'])
    const sc = landmarks.lm_succubus_banquet!.scenes![0]!
    expect(sceneText(collared, sc)).toContain('卡珊卓、其他不知名的魅魔')
    setFlag(collared, 'twin_lovers')
    setFlag(collared, 'luc_lover')
    setFlag(collared, 'noel_lover')
    expect(sceneText(collared, sc)).toContain('卡珊卓、蘿娜、菈娜、露西菈、諾艾爾')
    expect(sceneText(collared, sc)).not.toContain('不知名')
    const free = at('lm_succubus_banquet', ['cas_lover', 'cas_free'])
    expect(titles(free)).toEqual(['被女王們玩弄', '被女王們服侍'])
  })

  it('lets only a feminine or androgynous hero join Aya, and hides the club with NTR turned off', () => {
    expect(titles(at('lm_ebony_night', ['aya_club'], 'masc'))).toEqual(['看阿雅和水手們'])
    expect(titles(at('lm_ebony_night', ['aya_club'], 'fem'))).toEqual(['看阿雅和水手們', '和阿雅一起侍奉水手們'])
    const andro = at('lm_ebony_night', ['aya_club'], 'andro')
    expect(titles(andro)).toHaveLength(2)
    setContentFilters({ ntr: false })
    expect(titles(andro)).toEqual([])
  })

  it('opens the honor hole after Elena tells you about it in her first quest', () => {
    expect(landmarks.lm_honor_hole!.open?.flags).toEqual(['wl_1_done'])
    const first = stories.find((s) => s.id === 'lab_medium')!
    expect(JSON.stringify(first)).toContain('榮譽洞')
    expect(JSON.stringify(first)).toContain('精液或愛液')
    const state = at('lm_honor_hole', ['wl_1_done'])
    expect(titles(state)).toEqual(['當服務的一方', '當被服務的一方'])
    expect(landmarkHere(state)?.id).toBe('lm_honor_hole')
  })

  it('needs the wives and the idols all there', () => {
    const tea = at('lm_wives_salon', ['group_wives_done'])
    expect(sceneText(tea, landmarks.lm_wives_salon!.scenes![0]!)).toContain('瑪格麗特・馮・艾森、莉澤洛特、克拉拉')
    const idols = at('lm_idol_backstage', ['group_idols_done'])
    expect(titles(idols)).toEqual(['演出後替三人「充電」'])
  })
})

describe('landmark scenes in the content editor', () => {
  it('keeps the fields that make sense and drops the rest', () => {
    const sc = sanitizeScene({
      title: '測試', scene: '{cast}在這裡', tags: ['adult', 'bogus'], pc_body: ['fem', 'masc', 'andro'],
      cast: [{ npc: 'npc_mimi', flags: ['x'] }, { npc: 'nobody' }, { npc: 'npc_mimi' }], cooldown_days: 3, affinity: 99, own_cooldown: true,
      requires: { flags: ['a'], flags_none: [] },
    })!
    expect(sc).toEqual({ title: '測試', scene: '{cast}在這裡', tags: ['adult'], cast: [{ npc: 'npc_mimi', flags: ['x'] }], hours: 2, affinity: 30, own_cooldown: true, requires: { flags: ['a'] } })
    expect(sanitizeScene({ title: '沒有經過', scene: '' })).toBeUndefined()
  })

  it('saves a landmark with its scenes and the adult switch', () => {
    const l = JSON.parse(JSON.stringify(landmarks.lm_maid_cafe)) as never
    const m = sanitizeLandmarkMod('lm_maid_cafe', l)
    expect(m.open?.adult).toBe(true)
    expect(m.scenes).toEqual(landmarks.lm_maid_cafe!.scenes)
    applyContent(normalizeMods({ ...emptyMods(), landmarks: { lm_maid_cafe: { ...m, scenes: m.scenes!.slice(0, 1) } } }))
    expect(landmarks.lm_maid_cafe!.scenes).toHaveLength(1)
  })
})

describe('characters moved by their story stage', () => {
  it('are not rewritten each time they are looked up, so the map does not keep redrawing', async () => {
    const { npcRecord } = await import('@/engine/npcs')
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 4, birthplace: 'dawnlight' })
    setFlag(state, 'eve_lover')
    const first = npcRecord(state, 'npc_eve')!
    expect(first.stage).toBeDefined()
    const haunts = first.haunts
    const again = npcRecord(state, 'npc_eve')!
    expect(again).toBe(first)
    expect(again.haunts).toBe(haunts)
  })
})

describe('special-area interiors', () => {
  it('give every special area its own room map, with each scene in a room of it', async () => {
    const { specialMaps } = await import('@/engine/data')
    for (const id of AREAS) {
      const l = landmarks[id]!
      const m = specialMaps[l.interior!]!
      expect(m.location, id).toBe(l.location)
      expect(m.peaceful, id).toBe(true)
      expect(m.lighting, id).toBe('lit')
      for (const sc of l.scenes!) {
        expect(sc.spot, `${id} ${sc.title}`).toBeDefined()
        expect(m.grid![sc.spot!.y]![sc.spot!.x], `${id} ${sc.title}`).toBe('.')
        expect(sc.spot_name, `${id} ${sc.title}`).toBeTruthy()
      }
      expect(specialMapUsage(m.id)).toContain(`地標「${l.name}」的內部`)
    }
  })

  it('lets you walk in through the landmark, offers nothing at the door, and brings you back out to it', () => {
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 4, birthplace: 'albena' })
    setFlag(state, 'wl_1_done')
    enterLocation(state)
    standOn(state, 'lm_honor_hole' as never)
    const door = { ...state.position! }
    expect(scenesHere(state)).toEqual([])
    expect(interiorBlocked(state)).toBeUndefined()
    enterLandmark(state)
    expect(currentArea(state).key).toBe('sm/sm_honor_hole')
    expect(insideLandmark(state, landmarks.lm_honor_hole!)).toBe(true)
    expect(currentCell(state).kind).toBe('exit')
    expect(scenesHere(state)).toEqual([])
    expect([...sceneSpots(state).values()]).toEqual(['牆的這一邊（服務）', '牆的那一邊（被服務）'])
    expect(ambushChance(state)).toBe(0)
    expect(sceneBlocked(state, 0)).toBe('這裡沒有這個場景')
    state.position = { ...state.position!, x: 3, y: 1 }
    expect(scenesHere(state).map((x) => x.scene.title)).toEqual(['當服務的一方'])
    state.position = { ...state.position!, x: 5, y: 1 }
    expect(scenesHere(state).map((x) => x.scene.title)).toEqual(['當被服務的一方'])
    leaveSpecial(state)
    expect(state.position).toEqual(door)
    expect(landmarkHere(state)?.id).toBe('lm_honor_hole')
  })

  it('keeps the door shut while the venue is closed', () => {
    const state = at('lm_ebony_night', ['aya_club'])
    leaveSpecial(state)
    state.time.hour = 12
    expect(interiorBlocked(state)).toBe('黑檀之夜只在夜裡開放')
    expect(() => enterLandmark(state)).toThrow()
  })

  it('keeps an interior only in the same settlement, and spots only on cells you can stand on', () => {
    const l = JSON.parse(JSON.stringify(landmarks.lm_honor_hole)) as never as Record<string, unknown> & { scenes: { spot?: unknown }[] }
    expect(sanitizeLandmarkMod('lm_honor_hole', l as never).interior).toBe('sm_honor_hole')
    l.scenes[0]!.spot = { x: 4, y: 1 }
    expect(sanitizeLandmarkMod('lm_honor_hole', l as never).scenes![0]!.spot).toBeUndefined()
    expect(sanitizeLandmarkMod('lm_honor_hole', { ...l, interior: 'sm_maid_cafe' } as never).interior).toBeUndefined()
    expect(sanitizeLandmarkMod('lm_honor_hole', { ...l, interior: 'sm_maid_cafe' } as never).scenes!.every((x) => !x.spot)).toBe(true)
  })
})

describe('special areas after the play test', () => {
  it('are never picked as a place for guild quests', () => {
    for (const id of AREAS) {
      const l = landmarks[id]!
      for (let seed = 1; seed <= 20; seed++) {
        const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed, birthplace: l.location })
        for (const f of [...l.open!.flags!, 'cas_free']) setFlag(state, f)
        enterLocation(state)
        expect(guildQuests(state).some((q) => q.landmark === id), `${id} seed ${seed}`).toBe(false)
      }
    }
  })

  it('disappear when no scene could be chosen there', () => {
    const club = at('lm_ebony_night', ['aya_club'])
    expect(landmarkHere(club)?.id).toBe('lm_ebony_night')
    setContentFilters({ ntr: false })
    expect(landmarkHidden(club, landmarks.lm_ebony_night!)).toBe(true)
    setContentFilters({ ntr: true })
    expect(landmarkHidden(club, landmarks.lm_ebony_night!)).toBe(false)
    const salon = at('lm_wives_salon', ['group_wives_done'])
    npcRecord(salon, 'npc_clara')!.dead = true
    expect(landmarkHidden(salon, landmarks.lm_wives_salon!)).toBe(true)
  })

  it('move Eve and Ren into the maid cafe once it opens', () => {
    const state = at('lm_maid_cafe', ['mimi_lover', 'eve_lover'])
    expect(npcRecord(state, 'npc_eve')?.location).toBe('dawnlight')
    expect(npcRecord(state, 'npc_eve')?.fixed?.area).toBe('sm/sm_maid_cafe')
    expect(npcRecord(state, 'npc_ren')?.location).toBe('tidehaven')
    setFlag(state, 'ren_lover')
    setFlag(state, 'ren_land')
    expect(npcRecord(state, 'npc_ren')?.fixed?.area).toBe('sm/sm_maid_cafe')
    expect(currentArea(state).key).toBe('sm/sm_maid_cafe')
    const here = peopleHere(state).map((p) => p.rec.id)
    expect(here).toContain('npc_eve')
    expect(here).toContain('npc_ren')
    // 只有伊芙線、咖啡廳還沒開：留在萊茵堡
    const only = at('lm_wives_salon', ['group_wives_done', 'eve_lover'])
    expect(npcRecord(only, 'npc_eve')?.location).toBe('rhineburg')
  })
})

describe('characters in the special-area rooms', () => {
  // 每個特殊區域：打開它的旗標、時段，以及應該站在裡面的人
  const CASES: [string, string[], number, string[]][] = [
    ['lm_maid_cafe', ['mimi_lover', 'eve_lover', 'mimi_cafe', 'ren_lover', 'ren_land'], 14, ['npc_mimi', 'npc_eve', 'npc_ren']],
    ['lm_wives_salon', ['group_wives_done', 'marg_lover', 'liese_lover', 'clara_lover'], 14, ['npc_margarete', 'npc_lieselotte', 'npc_clara']],
    ['lm_ebony_night', ['aya_club'], 22, ['npc_aya']],
    ['lm_succubus_banquet', ['cas_lover', 'cas_free', 'twin_lovers', 'luc_lover', 'noel_lover'], 22, ['npc_cassandra', 'npc_rona', 'npc_lana', 'npc_lucia', 'npc_noel']],
    ['lm_idol_backstage', ['group_idols_done', 'stella_lover', 'noir_lover', 'pom_lover'], 22, ['npc_stella', 'npc_noir', 'npc_pom']],
  ]

  it('stand in their own rooms of the interior once their area opens', () => {
    for (const [id, flags, hour, who] of CASES) {
      const state = at(id, flags)
      state.time.hour = hour
      const area = currentArea(state)
      expect(area.key, id).toBe(`sm/${landmarks[id]!.interior}`)
      const here = peopleHere(state)
      for (const npc of who) {
        const p = here.find((x) => x.rec.id === npc)
        expect(p, `${id} ${npc}`).toBeDefined()
        expect(area.cells[p!.y * area.width + p!.x]!.kind, `${id} ${npc}`).not.toBe('wall')
      }
      // 每個人站在不同的格子
      const cells = who.map((npc) => here.find((x) => x.rec.id === npc)!).map((p) => `${p.x},${p.y}`)
      expect(new Set(cells).size, id).toBe(who.length)
    }
  })

  it('keep the night venues to the night and the tea party to the afternoon', () => {
    const club = at('lm_ebony_night', ['aya_club'])
    club.time.hour = 10
    expect(npcRecord(club, 'npc_aya')?.fixed).toBeUndefined()
    expect(npcRecord(club, 'npc_aya')?.location).toBe('soriel')
    club.time.hour = 22
    expect(npcRecord(club, 'npc_aya')?.fixed?.area).toBe('sm/sm_ebony_night')
    const salon = at('lm_wives_salon', ['group_wives_done', 'clara_lover'])
    salon.time.hour = 22
    expect(npcRecord(salon, 'npc_clara')?.fixed).toBeUndefined()
    salon.time.hour = 14
    expect(npcRecord(salon, 'npc_clara')?.fixed?.area).toBe('sm/sm_wives_salon')
  })

  it('leave the twins, Lucia and Noel out of the banquet hall until they are lovers', () => {
    const state = at('lm_succubus_banquet', ['cas_lover', 'cas_collared', 'twin_lovers'])
    expect(npcRecord(state, 'npc_rona')?.fixed?.area).toBe('sm/sm_succubus_banquet')
    expect(npcRecord(state, 'npc_lucia')?.fixed).toBeUndefined()
    expect(npcRecord(state, 'npc_noel')?.fixed).toBeUndefined()
  })
})

describe('work-line scenes', () => {
  // 打工線完成之後，委託人的地標出現可以重複的打工場景；有制服的線要穿著
  const WORK = ['lm_silverscale_inn', 'lm_odd_tower', 'lm_golden_dice', 'lm_tent_ring_bazaar', 'lm_krause_manor', 'lm_pilgrim_bath', 'lm_pearl_bath',
    'lm_ironforge_onsen', 'lm_lower_massage', 'lm_nude_atelier', 'lm_blood_trial_ground', 'lm_bed_school']

  it('open after the line is done, only for feminine and androgynous heroes, and pay for the work', () => {
    for (const id of WORK) {
      const scenes = landmarks[id]!.scenes!
      expect(scenes.length, id).toBeGreaterThan(0)
      for (const sc of scenes) {
        expect(sc.requires?.flags?.[0], `${id} ${sc.title}`).toMatch(/_done$/)
        expect(sc.tags, sc.title).toContain('male_partner')
        expect(sc.pc_body, sc.title).toEqual(['fem', 'andro'])
        expect(sc.effects?.find((e) => e.type === 'money'), sc.title).toBeTruthy()
        expect(sanitizeScene(sc, landmarks[id]!.interior)).toEqual(sc)
      }
    }
  })

  it('stay on the map while a quest there can be taken or is going on, so the quest nodes can be reached', () => {
    const used = new Set(stories.flatMap((d) => d.nodes.filter((n) => n.at.where === 'cell' && landmarks[n.at.cell ?? '']).map((n) => n.at.cell!)))
    for (const id of used) {
      const l = landmarks[id]!
      if (l.open?.hidden) continue
      const state = newGame({ name: '艾琳', race: 'human', classId: 'rogue', seed: 4, birthplace: l.location, gender: '女', body: 'fem' })
      state.guild = { rank: 'S', merit: 999 }
      pcOf(state).level = 20
      enterLocation(state)
      const a = getArea(state, l.at.area)
      expect(a.cells[l.at.y * a.width + l.at.x]?.kind, id).toBe(id)
    }
  })

  it('hide a work landmark when nothing there is for this hero, and bring it back for a quest going on', () => {
    const l = landmarks.lm_odd_tower!
    // 等級、公會階級都不夠：任務接不到、也沒有場景
    const state = newGame({ name: '艾琳', race: 'human', classId: 'rogue', seed: 4, birthplace: l.location, gender: '女', body: 'fem' })
    expect(landmarkHidden(state, l)).toBe(true)
    state.guild = { rank: 'S', merit: 999 }
    pcOf(state).level = 20
    expect(landmarkHidden(state, l)).toBe(false)
    // 陽剛的主角接不到打工線
    pcOf(state).body = 'masc'
    expect(landmarkHidden(state, l)).toBe(true)
    // 進行中的任務還要用到時留著（等級不夠接新任務也一樣）
    pcOf(state).body = 'fem'
    startStory(state, 'odd_measure')
    pcOf(state).level = 1
    expect(landmarkHidden(state, l)).toBe(false)
    pcOf(state).level = 20
    // 體型改成陽剛：進行中的任務暫停，地標也跟著不出現；打開「陽剛體型也能遇到」的設定後回來
    pcOf(state).body = 'masc'
    expect(landmarkHidden(state, l)).toBe(true)
    setMascBodyContent(true)
    expect(landmarkHidden(state, l)).toBe(false)
    setMascBodyContent(false)
    // 線完成之後有場景
    pcOf(state).body = 'fem'
    state.stories!.odd_measure!.status = 'completed'
    setFlag(state, 'odd_done')
    expect(landmarkHidden(state, l)).toBe(false)
  })

  it('ask for the uniform before you can go back to work', () => {
    const l = landmarks.lm_golden_dice!
    const state = newGame({ name: '艾琳', race: 'human', classId: 'rogue', seed: 4, birthplace: l.location, gender: '女', body: 'fem' })
    state.time.hour = 21
    state.guild = { rank: 'S', merit: 999 }
    pcOf(state).level = 20
    enterLocation(state)
    expect(standOn(state, 'lm_golden_dice' as never)).toBe(true)
    expect(scenesHere(state)).toEqual([])
    setFlag(state, 'dice_done')
    const i = scenesHere(state)[0]!.index
    expect(sceneBlocked(state, i)).toContain('兔女郎裝')
    addItem(state.inventory, '絲綢兔女郎裝', 1)
    addItem(state.inventory, '絲綢兔耳髮箍', 1)
    equipItem(state, '絲綢兔女郎裝', pcOf(state).id)
    equipItem(state, '絲綢兔耳髮箍', pcOf(state).id)
    expect(sceneBlocked(state, i)).toBeUndefined()
    const money = state.money_cc
    const report = playLandmarkScene(state, i)
    expect(state.money_cc).toBeGreaterThan(money)
    expect(report.narration?.adult_scene).toBeTruthy()
    expect(sceneBlocked(state, i)).toContain('天後')
  })
})
