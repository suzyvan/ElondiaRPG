import { afterEach, describe, expect, it } from 'vitest'
import { newGame } from '@/engine/state'
import { applyContent, emptyMods } from '@/engine/mods'
import { sanitizeStory, storyCheck } from '@/engine/storyMods'
import { canStart, storyPaused } from '@/engine/story'
import { condMet, counterValue, setFlag } from '@/engine/storyFlags'
import { dungeonEncounters, enemies, npcs as namedNpcs, stories } from '@/engine/data'
import { setContentFilters, tagsAllowed } from '@/engine/content'
import type { StoryDef } from '@/engine/data'

afterEach(() => {
  applyContent(emptyMods())
  setContentFilters({})
})

const game = () => newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 1 })
const story = (id: string) => stories.find((s) => s.id === id)!

// 內建的特殊任務不經過整理就直接用：要通過任務鏈的檢查，而且整理後不變（沒有超過長度、範圍的寫法）
describe('built-in stories', () => {
  it('pass the story check without errors or warnings', () => {
    const bad = stories.map((s) => ({ id: s.id, ...storyCheck(s) })).filter((r) => r.errors.length || r.warnings.length)
    expect(bad).toEqual([])
  })

  it('stay the same after sanitizing', () => {
    for (const s of stories) {
      const clean = sanitizeStory(s.id, s, false) as unknown as StoryDef
      expect(JSON.parse(JSON.stringify(clean)), s.id).toMatchObject(JSON.parse(JSON.stringify(s)))
    }
  })

  it('chains each storyline through its done flags and level bands', () => {
    const chains = [
      ['dawn_throne_ambush', 'dawn_throne_poison', 'dawn_throne_crown'],
      ['whisper_seal', 'whisper_oath', 'whisper_emperor'],
      ['lilian_successor', 'lilian_abbey', 'lilian_graduation'],
      ['rhine_raid', 'rhine_iron_cross', 'rhine_council'],
      ['mist_bell', 'mist_inquisition', 'mist_saint'],
      ['isadora_interview', 'isadora_ball', 'isadora_elope'],
      ['doctrine_notebook', 'doctrine_mirror', 'doctrine_council'],
      ['snake_red_creek', 'snake_eggs', 'snake_progenitor'],
      ['aya_prayer_book', 'aya_harbor', 'aya_last_confession'],
      ['aya_prayer_book', 'aya_harbor', 'aya_ebony_club'],
      ['rivervale_oath_stone', 'rivervale_cellar', 'rivervale_summit'],
      ['epic_bellringer', 'epic_undead_general', 'epic_frost_giant'],
      ['serena_golden_lotus', 'serena_councillor', 'serena_sea'],
      ['port_seized_ship', 'port_lighthouse', 'port_charter'],
      ['spirit_river_girl', 'spirit_upstream', 'spirit_drowned'],
      ['amelia_lonely_night', 'amelia_white_gull', 'amelia_ring'],
      ['commerce_false_bandits', 'commerce_false_coin', 'commerce_council_vote'],
      ['seacave_low_tide', 'seacave_siren', 'seacave_drowned_crew'],
      ['lab_medium', 'lab_sober', 'lab_guild_return'],
      ['annex_white_rook', 'annex_hill_exercise', 'annex_protection_treaty'],
      ['spy_pigeons', 'spy_valentin_brother', 'spy_secret_envoy'],
      ['defense_codebook', 'defense_mole', 'defense_spymaster'],
      ['lena_good_friend', 'lena_runaway', 'lena_lighter_love'],
      ['valerie_sample', 'valerie_stolen_paper', 'valerie_hearing'],
      ['eve_holiday', 'eve_tea_house', 'eve_master'],
      ['veronica_petitions', 'veronica_little_book', 'veronica_petition_day'],
      ['lisar_incognito', 'lisar_oath_valley', 'lisar_far_sight'],
      ['valkas_drinking_friend', 'valkas_war_games', 'valkas_molten_oath'],
      ['ignis_prototype', 'ignis_army_order', 'ignis_forge_titan'],
      ['noctis_ghostwriter', 'noctis_undelivered', 'noctis_evernight'],
      ['morphe_insomnia', 'morphe_moth_dust', 'morphe_dream_dragon'],
      ['law_weakest_king', 'law_iron_tongue', 'law_bone_throne'],
      ['trial_new_moon', 'trial_bloodhorn_warrior', 'trial_war_spirits'],
      ['god_silent_prophecy', 'god_white_flame', 'god_glimpse'],
      ['lila_travel_books', 'lila_first_trip', 'lila_living_world'],
      ['rot_herb_errand', 'rot_tax_collectors', 'rot_harvest_festival'],
      ['hm_greyport_contract', 'hm_ghost_ship', 'hm_abyss_treaty'],
      ['era_crystal_price', 'era_two_orders', 'era_best_of_times'],
      ['kagni_hammer_tone', 'kagni_burn_and_still', 'kagni_hoard'],
      ['ore_seal_knocking', 'ore_mistone_runes', 'ore_star_heart'],
      ['brew_cellar_queue', 'brew_bribed_cask', 'brew_clan_feast'],
      ['smith_fireless_iron', 'smith_heartfire_test', 'smith_council_verdict'],
      ['wt_spring_decline', 'wt_other_end', 'wt_new_sprout'],
      ['wat_dancer_rumor', 'wat_chart_island', 'wat_spring_heart'],
      ['smg_blacksail_cargo', 'smg_skull_tide', 'smg_under_council_eyes'],
      ['sinor_lagging_mirror', 'sinor_untold_legend', 'sinor_fog_locked'],
      ['acc_novel_girl', 'acc_kalanthil_courtesy', 'acc_sprout_and_root'],
      ['shadow_extra_star', 'shadow_same_dream', 'shadow_sorian_projection'],
      ['fog_lost_names', 'fog_mistveil', 'fog_behind_the_mist'],
      ['vault_missing_jade', 'vault_banquet_guest', 'vault_tide_mirror'],
      ['reef_odd_light', 'reef_coral_sickness', 'reef_barrier_crack'],
      ['nip_fake_catnip', 'nip_moonlight_herb', 'nip_sand_lions'],
      ['scs_cracked_accord', 'scs_nightclaw_intel', 'scs_sandcastle_shadow'],
      ['rite_broken_moon', 'rite_redmane_games', 'rite_wind_field'],
      ['bab_growing_tents', 'bab_restless_builders', 'bab_babelin_spire'],
      ['pit_exile_name', 'pit_unfinished_verdict', 'pit_blackiron_tyrant'],
      ['echo_dead_husband', 'echo_seal_log', 'echo_spirit_of_echoes'],
      ['gnt_mountain_heartbeat', 'gnt_rune_circuit', 'gnt_giant_king'],
      ['emb_warm_floors', 'emb_flame_weavers', 'emb_heart_of_flame'],
      ['brc_bloodsworn_squires', 'brc_fallen_king', 'brc_first_oathbreaker'],
      ['ghs_maneating_flowers', 'ghs_experiment_log', 'ghs_first_experiment'],
      ['msr_stolen_bows', 'msr_shard_avatar', 'msr_moon_core'],
      ['thc_moonlight_pilgrimage', 'thc_eaten_memories', 'thc_goddess_shadow'],
      ['vh_infected_elves', 'vh_alien_bloom', 'vh_otherworld_gate'],
      ['tfc_lost_envoy', 'tfc_forgotten_abyss', 'tfc_sea_god_remnant'],
      ['skl_no_survivors', 'skl_pirate_king_map', 'skl_kraken'],
      ['ecc_missing_hunter', 'ecc_calamity_shade', 'ecc_voice_of_catastrophe'],
      ['qst_unregistered', 'qst_sun_oracle', 'qst_sun_god_avatar'],
      ['luc_practice_partner', 'luc_succubus_manual', 'luc_eighth_exam'],
      ['cas_black_rose_guest', 'cas_collar_origin', 'cas_queen_kneels'],
      ['twin_sisters_test', 'twin_lana_song', 'twin_same_person'],
      ['noel_pretty_clerk', 'noel_prank_price', 'noel_getting_serious'],
      ['zero_warm_chest', 'zero_recall_order', 'zero_definition'],
      ['kar_challenge', 'kar_rigged_match', 'kar_arena_trophy'],
      ['oboro_rooftop_shadow', 'oboro_report', 'oboro_shadow_heart'],
      ['belv_bandit_hunter', 'belv_old_brand', 'belv_not_a_toy'],
      ['eil_ghost_bride', 'eil_lost_ring', 'eil_hundred_year_wedding'],
      ['pru_what_is_love', 'pru_ring_and_date', 'pru_swamp_wedding'],
      ['ila_elf_cold', 'ila_moon_bloom', 'ila_hundred_years'],
      ['mimi_clumsy_maid', 'mimi_tea_guild', 'mimi_opening_day'],
      ['stella_lost_idol', 'stella_empty_seats', 'stella_star_confession'],
      ['noir_blank_score', 'noir_fan_letters', 'noir_song_for_whom'],
      ['pom_unpaid_fee', 'pom_theater_contract', 'pom_guard_contract'],
      ['marg_salon_newcomer', 'marg_unsent_letters', 'marg_masked_ball'],
      ['liese_heavy_flour', 'liese_front_basket', 'liese_harvest_festival'],
      ['clara_lilac_reader', 'clara_field_research', 'clara_last_chapter'],
      ['isab_drinking_bet', 'isab_young_knight', 'isab_last_bet'],
      ['brun_sweet_tooth', 'brun_academy_speech', 'brun_frost_shield'],
      ['kara_great_hunt', 'kara_suitors', 'kara_mane_oath'],
      ['ren_bath_maid', 'ren_land_holiday', 'ren_tide_home'],
      ['mat_innocent_question', 'mat_lost_puppy', 'mat_honest_contract'],
      ['ith_moon_query', 'ith_old_garden', 'ith_mortal_time'],
      ['ana_sneak_out', 'ana_body_double', 'ana_crown_and_road'],
      ['ele_chancellor_lunch', 'ele_greenhouse', 'ele_last_edict'],
      ['lisr_red_again', 'lisr_court_currents', 'lisr_crimson_vow'],
      ['sak_land_banquet', 'sak_lost_sister', 'sak_tide_challenge'],
    ]
    for (const ids of chains) {
      const levels = ids.map((id) => story(id).start.min_level)
      expect(levels).toEqual([5, 8, 11])
      for (let i = 1; i < ids.length; i++) expect(story(ids[i]!).start.requires?.flags?.length, ids[i]).toBeGreaterThan(0)
    }
    const adult = ['lilian_successor', 'lilian_abbey', 'lilian_graduation', 'isadora_interview', 'isadora_ball', 'isadora_elope', 'aya_prayer_book', 'aya_harbor', 'aya_last_confession', 'aya_ebony_club', 'serena_golden_lotus', 'serena_councillor', 'serena_sea', 'amelia_lonely_night', 'amelia_white_gull', 'amelia_ring', 'lab_medium', 'lab_sober', 'lab_guild_return', 'lena_good_friend', 'lena_runaway', 'lena_lighter_love', 'valerie_sample', 'valerie_stolen_paper', 'valerie_hearing', 'eve_holiday', 'eve_tea_house', 'eve_master', 'luc_practice_partner', 'luc_succubus_manual', 'luc_eighth_exam', 'cas_black_rose_guest', 'cas_collar_origin', 'cas_queen_kneels', 'twin_sisters_test', 'twin_lana_song', 'twin_same_person', 'noel_pretty_clerk', 'noel_prank_price', 'noel_getting_serious', 'zero_warm_chest', 'zero_recall_order', 'zero_definition', 'kar_challenge', 'kar_rigged_match', 'kar_arena_trophy', 'oboro_rooftop_shadow', 'oboro_report', 'oboro_shadow_heart', 'belv_bandit_hunter', 'belv_old_brand', 'belv_not_a_toy', 'eil_ghost_bride', 'eil_lost_ring', 'eil_hundred_year_wedding', 'pru_what_is_love', 'pru_ring_and_date', 'pru_swamp_wedding', 'ila_elf_cold', 'ila_moon_bloom', 'ila_hundred_years', 'mimi_clumsy_maid', 'mimi_tea_guild', 'mimi_opening_day', 'stella_lost_idol', 'stella_empty_seats', 'stella_star_confession', 'noir_blank_score', 'noir_fan_letters', 'noir_song_for_whom', 'pom_unpaid_fee', 'pom_theater_contract', 'pom_guard_contract', 'marg_salon_newcomer', 'marg_unsent_letters', 'marg_masked_ball', 'liese_heavy_flour', 'liese_front_basket', 'liese_harvest_festival', 'clara_lilac_reader', 'clara_field_research', 'clara_last_chapter', 'ren_bath_maid', 'ren_land_holiday', 'ren_tide_home']
    expect(adult.every((id) => story(id).tags?.includes('adult'))).toBe(true)
    // 不是成人向角色的戀愛線（運動系三人、瑪蒂爾達、五位女統治者）不標成人向，成人內容關閉時也能玩
    expect(['isab_drinking_bet', 'isab_young_knight', 'isab_last_bet', 'brun_sweet_tooth', 'brun_academy_speech', 'brun_frost_shield', 'kara_great_hunt', 'kara_suitors', 'kara_mane_oath', 'mat_innocent_question', 'mat_lost_puppy', 'mat_honest_contract', 'ith_moon_query', 'ith_old_garden', 'ith_mortal_time', 'ana_sneak_out', 'ana_body_double', 'ana_crown_and_road', 'ele_chancellor_lunch', 'ele_greenhouse', 'ele_last_edict', 'lisr_red_again', 'lisr_court_currents', 'lisr_crimson_vow', 'sak_land_banquet', 'sak_lost_sister', 'sak_tide_challenge'].every((id) => !story(id).tags?.includes('adult'))).toBe(true)
    // 角色在任務開始前就有性經驗：標非處女
    expect(['serena_golden_lotus', 'serena_councillor', 'serena_sea', 'amelia_lonely_night', 'amelia_white_gull', 'amelia_ring', 'lab_medium', 'lab_sober', 'lab_guild_return', 'cas_black_rose_guest', 'cas_collar_origin', 'cas_queen_kneels', 'belv_bandit_hunter', 'belv_old_brand', 'belv_not_a_toy', 'marg_salon_newcomer', 'marg_unsent_letters', 'marg_masked_ball', 'liese_heavy_flour', 'liese_front_basket', 'liese_harvest_festival', 'clara_lilac_reader', 'clara_field_research', 'clara_last_chapter'].every((id) => story(id).tags?.includes('non_virgin'))).toBe(true)
  })

  it('opens the group quests only after every member romance line is done', () => {
    const groups: Record<string, string[]> = {
      group_wives_tea: ['marg_lover', 'liese_lover', 'clara_lover'],
      group_idol_backstage: ['stella_lover', 'noir_lover', 'pom_lover'],
      group_rulers_tea: ['ith_lover', 'ana_lover', 'ele_lover', 'lisr_lover', 'sak_lover'],
      group_athletes: ['isab_lover', 'brun_lover', 'kara_lover'],
      group_contract_bond: ['mat_lover', 'ser_lover'],
    }
    for (const [id, flags] of Object.entries(groups)) {
      const s = story(id)
      expect(s.rank, id).toBe('B')
      expect(s.start.min_level, id).toBe(11)
      expect([...(s.start.requires?.flags ?? [])].sort(), id).toEqual([...flags].sort())
    }
    // 女統治者們的茶話會另外要求和平線（人類、魔族兩邊都走向和平）
    expect(story('group_rulers_tea').start.requires?.counters).toEqual({ human_stance: { min: 1 }, demon_stance: { min: 1 } })
    // 成員有成人向角色的才標成人向
    expect(['group_wives_tea', 'group_idol_backstage', 'group_contract_bond'].every((id) => story(id).tags?.includes('adult'))).toBe(true)
    expect(['group_rulers_tea', 'group_athletes'].every((id) => !story(id).tags?.includes('adult'))).toBe(true)
  })

  it('splits the political epic by the two stance counters', () => {
    const routes = story('pol_storm_eve').nodes.filter((n) => n.id.startsWith('route'))
    for (let h = -3; h <= 3; h++) {
      for (let d = -3; d <= 3; d++) {
        const g = game()
        g.flags['count:human_stance'] = h
        g.flags['count:demon_stance'] = d
        setFlag(g, 'pol_echoed')
        // 路線的任務點照兩邊的走向拆開，任何情況都剛好開一個
        const open = routes.filter((n) => condMet(g, n.requires))
        expect(open.length, `${h},${d}`).toBe(1)
        const shown = (open[0]!.options ?? []).map((o) => o.success?.set_flags?.[0])
        // 兩邊都主和只能清剿、兩邊都主戰只能開戰，其他情況兩條都能選
        const want = h >= 1 && d >= 1 ? ['pol_route_peace'] : h <= -1 && d <= -1 ? ['pol_route_war'] : ['pol_route_peace', 'pol_route_war']
        expect(shown.sort(), `${h},${d}`).toEqual(want)
      }
    }
  })

  it('runs each epic route through Lv.15–17 and ends in the shared Lv.18 finale', () => {
    const routes = [
      ['pol_peace', 'pol_peace_iron_cross', 'pol_peace_bloodhorn', 'pol_peace_crusade', 'pol_peace_done'],
      ['pol_war_human', 'pol_war_h_rivervale', 'pol_war_h_ashport', 'pol_war_h_bloodplume', 'pol_war_h_done'],
      ['pol_war_demon', 'pol_war_d_ashport', 'pol_war_d_rivervale', 'pol_war_d_rhineburg', 'pol_war_d_done'],
    ]
    expect(story('pol_storm_eve').start.min_level).toBe(14)
    for (const [entry, ...rest] of routes) {
      const ids = rest.slice(0, 3)
      expect(ids.map((id) => story(id).start.min_level)).toEqual([15, 16, 17])
      expect(story(ids[0]!).start.requires?.flags).toEqual([entry])
      // 結局之後是論功行賞：三選一的獨特飾品
      const last = story(ids[2]!)
      const ends = last.nodes.filter((n) => n.id !== 'spoils').flatMap((n) => (n.options ?? []).map((o) => o.success?.set_flags ?? []))
      expect(ends.every((f) => f.includes(rest[3]!))).toBe(true)
      const spoils = last.nodes.find((n) => n.id === 'spoils')!
      expect(spoils.options!.map((o) => o.success?.effects?.[0]?.type)).toEqual(['item', 'item', 'item'])
      expect(spoils.options!.every((o) => o.success?.complete)).toBe(true)
    }
    const fin = story('pol_acheron_gaze')
    expect(fin.start.min_level).toBe(18)
    expect([...(fin.start.requires?.flags_any ?? [])].sort()).toEqual(['pol_peace_done', 'pol_war_d_done', 'pol_war_h_done'])
    // 終章的戰鬥輸了可以重試；結局留下龍災的旗標給巨龍史詩
    expect(fin.nodes.find((n) => n.id === 'heroes')!.fail?.retry).toBe(true)
    expect(fin.nodes.find((n) => n.id === 'eye')!.options!.every((o) => o.success?.set_flags?.includes('dragon_calamity'))).toBe(true)
    expect(fin.nodes.find((n) => n.id === 'spoils')!.options!.length).toBe(3)
  })

  it('ends the dragon epic in Acheron after the four dragons, with retryable boss fights', () => {
    const dragons = ['drg_kagni', 'drg_sinor', 'drg_sorian', 'drg_babelin']
    expect(dragons.map((id) => story(id).start.min_level)).toEqual([18, 18, 19, 19])
    for (const id of dragons) expect(story(id).start.requires?.flags).toEqual(['dragon_calamity'])
    const fin = story('drg_acheron')
    expect(fin.start.min_level).toBe(20)
    expect([...(fin.start.requires?.flags ?? [])].sort()).toEqual(['drg_bab_done', 'drg_kag_done', 'drg_sin_done', 'drg_sor_done'])
    // 史詩線的頭目戰（政治線的高潮、終章與五條龍）：頭目加一隻手下，輸了可以重試
    const epic = stories.filter((s) => s.id.startsWith('drg_') || s.id.startsWith('pol_'))
    const bossNodes = epic.flatMap((s) => s.nodes.filter((n) => n.enemies?.some(([e]) => (enemies[e]?.hp ?? 0) > 500)).map((n) => ({ s, n })))
    expect(bossNodes.map(({ s }) => s.id).sort()).toEqual(['drg_acheron', 'drg_babelin', 'drg_kagni', 'drg_sinor', 'drg_sorian', 'pol_acheron_gaze', 'pol_peace_bloodhorn', 'pol_peace_crusade', 'pol_war_d_rhineburg', 'pol_war_h_bloodplume'])
    for (const { s, n } of bossNodes) {
      expect(n.enemies?.length, s.id).toBe(2)
      expect(n.fail?.retry, s.id).toBe(true)
      expect(n.fail?.set_flags ?? [], s.id).toEqual([])
    }
  })

  it('makes the strong-looking opponents of the storylines bosses: one boss with an ultimate plus one minion', () => {
    // 任務線裡看起來很強的對手（傳說、神靈、古老的守護者、巨大的野獸、有名有姓的首領）不會兩三下就倒
    const fights: [string, string, string][] = [
      ['lilian_graduation', 'shadows', 'first_star_heir'], ['mist_saint', 'seraphs', 'grey_wing_seraph'], ['lisar_far_sight', 'spine', 'fallen_dragon_grudge'],
      ['ignis_forge_titan', 'wake', 'forge_titan_prime'], ['zero_definition', 'titans', 'forge_titan_prime'], ['morphe_dream_dragon', 'wardens', 'dream_gatekeeper'],
      ['trial_war_spirits', 'spirits', 'elder_war_spirit'], ['god_glimpse', 'flame', 'white_flame_warden'], ['lila_living_world', 'wardens', 'tomb_warden_elder'],
      ['eil_hundred_year_wedding', 'wardens', 'tomb_warden_elder'], ['rot_harvest_festival', 'wyrm', 'mire_wyrm_mother'], ['kagni_hoard', 'wardens', 'blaze_warden'],
      ['ore_star_heart', 'wardens', 'elder_gate_warden'], ['wt_new_sprout', 'treants', 'blight_treant_elder'], ['wat_spring_heart', 'guardian', 'great_tide_guardian'],
      ['shadow_sorian_projection', 'guardians', 'mist_scale_warden'], ['fog_behind_the_mist', 'wardens', 'mist_warden_patriarch'], ['rite_wind_field', 'ancestors', 'first_ancestor_spirit'],
      ['bab_babelin_spire', 'sentinels', 'great_tower_sentinel'], ['ila_hundred_years', 'treants', 'thousand_year_bloom'], ['pru_swamp_wedding', 'crocs', 'old_mire_king'],
      ['kara_mane_oath', 'rocs', 'thunder_plume_roc'], ['ith_mortal_time', 'beasts', 'withered_forest_warden'], ['clara_last_chapter', 'inquisitors', 'chief_book_inquisitor'],
      ['pol_peace_bloodhorn', 'duel', 'bloodhorn_warmaster'],
    ]
    for (const [id, node, boss] of fights) {
      const n = story(id).nodes.find((x) => x.id === node)!
      expect(n.enemies?.map(([e, k]) => [e === boss, k]), `${id}:${node}`).toEqual([[true, 1], [false, 1]])
      expect(enemies[boss]!.ability_hp_below, boss).toBeTruthy()
      expect(enemies[boss]!.level, boss).toBeGreaterThan(enemies[n.enemies![1]![0]]!.level)
    }
  })

  it('only fights stand-in monsters, never fixed NPCs, and kills the king on the story node', () => {
    expect(stories.flatMap((s) => s.nodes.flatMap((n) => n.foes ?? []))).toEqual([])
    const deaths = stories.flatMap((s) => s.nodes.flatMap((n) => [n.success, n.fail, ...(n.options ?? []).flatMap((o) => [o.success, o.fail])].flatMap((o) => o?.deaths ?? [])))
    expect(deaths).toEqual(['npc_alexander'])
  })

  it('opens the next quest only after the previous one, at its level and rank', () => {
    const state = game()
    const poison = story('dawn_throne_poison')
    state.party[0]!.level = 8
    state.guild = { rank: 'C', merit: 0 }
    expect(canStart(state, poison)).toBe(false)
    setFlag(state, 'dthr_1_done', true)
    expect(canStart(state, poison)).toBe(true)
    state.party[0]!.level = 7
    expect(canStart(state, poison)).toBe(false)
    // 選擇的結果推動人類世界的走向：公主 +1、皇子 -1
    const [princess, prince] = poison.nodes.find((n) => n.id === 'choose')!.options!.map((o) => o.success!)
    expect([princess!.counters, prince!.counters]).toEqual([{ human_stance: 1 }, { human_stance: -1 }])
    expect(counterValue(state, 'human_stance')).toBe(0)
  })

  it('opens the adult storyline like any other', () => {
    const state = game()
    state.party[0]!.level = 5
    state.guild = { rank: 'D', merit: 0 }
    state.relationships = { ...state.relationships, npc_lilian: { affinity: 10 } as never }
    expect(canStart(state, story('lilian_successor'))).toBe(true)
  })

  it('gives the new monarch a staged identity', () => {
    const ana = namedNpcs.find((n) => n.id === 'npc_anastasia')!
    const queen = ana.stages!.find((s) => s.requires.flags?.includes('dthr_queen'))!
    expect(queen.background).toContain('女王')
    expect(queen.tags).toEqual(['royal'])
    const alexei = namedNpcs.find((n) => n.id === 'npc_alexei')!
    expect(alexei.stages!.some((s) => s.requires.flags?.includes('dthr_king') && s.background?.includes('國王'))).toBe(true)
  })

  it('plays the coronation: the king dies on the story node and the queen takes her staged identity', async () => {
    const { startStory, playNode } = await import('@/engine/story')
    const { npcRecord } = await import('@/engine/npcs')
    const { joinParty } = await import('@/engine/party')
    const state = game()
    setFlag(state, 'dthr_back_princess')
    startStory(state, 'dawn_throne_crown')
    // 洛倫佐在身邊（任務點是「這位角色在身邊時」）
    joinParty(state, npcRecord(state, 'npc_lorenzo_valois')!, 'guest')
    playNode(state, 'dawn_throne_crown:deathbed')
    expect(npcRecord(state, 'npc_alexander')!.dead).toBe(true)
    expect(state.stories!.dawn_throne_crown!.status).toBe('active')
    setFlag(state, 'dthr_coup_done')
    playNode(state, 'dawn_throne_crown:crown_queen', 0)
    expect(state.stories!.dawn_throne_crown!.status).toBe('completed')
    expect(counterValue(state, 'human_stance')).toBe(1)
    expect(npcRecord(state, 'npc_anastasia')!.background).toContain('登基為晨曦王國的女王')
    expect(npcRecord(state, 'npc_alexei')!.background).toContain('守邊公爵')
  })

  it('never talks with the emperor of whispers: he is fought, then sealed, and keeps coming back', () => {
    const emperor = story('whisper_emperor')
    const throne = emperor.nodes.find((n) => n.id === 'throne')!
    expect(throne.kind).toBe('combat')
    expect(throne.enemies?.[0]?.[0]).toBe('emperor_of_whispers')
    expect(emperor.nodes.every((n) => (n.options ?? []).every((o) => !o.label.includes('勸')))).toBe(true)
    expect(enemies.emperor_of_whispers!.desc).toContain('重新聚起形體')
  })

  it('explains why every abyss boss comes back: the history dragon replays the place', () => {
    const bosses = Object.values(dungeonEncounters).flatMap((t) => (t.bosses?.abyss ?? []).map((g) => g[0]))
    const strongest = bosses.filter((id) => enemies[id]!.level >= 13)
    expect(strongest.length).toBeGreaterThanOrEqual(16)
    for (const id of strongest) expect(enemies[id]!.desc, id).toContain('阿契隆')
  })

  it('lets the party retry an abyss boss fight: the fail outcome keeps the node open', () => {
    const bosses = new Set(Object.values(dungeonEncounters).flatMap((t) => (t.bosses?.abyss ?? []).map((g) => g[0])).filter((id) => enemies[id]!.level >= 13))
    const fights = stories.flatMap((s) => s.nodes.filter((n) => n.kind === 'combat' && (n.enemies ?? []).some(([m]) => bosses.has(m))).map((n) => ({ id: s.id, n })))
    expect(fights.length).toBeGreaterThanOrEqual(15)
    for (const { id, n } of fights) {
      expect(n.fail?.retry, `${id}:${n.id}`).toBe(true)
      expect(n.fail?.set_flags ?? [], `${id}:${n.id}`).toEqual([])
    }
    for (const [id, node] of [['trial_new_moon', 'lizards'], ['trial_bloodhorn_warrior', 'beasts'], ['trial_war_spirits', 'spirits'], ['law_bone_throne', 'axes']]) {
      expect(story(id!).nodes.find((n) => n.id === node)!.fail?.retry, `${id}:${node}`).toBe(true)
    }
  })

  it('keeps every fixed NPC a storyline needs out of reach of a sneak attack', () => {
    const needed = new Set<string>()
    for (const st of stories) {
      if (st.start.npc) needed.add(st.start.npc)
      for (const n of st.nodes) {
        if (n.at?.npc) needed.add(n.at.npc)
        for (const a of n.allies ?? []) needed.add(a)
        for (const o of [n.success, n.fail, ...(n.options ?? []).flatMap((x) => [x.success, x.fail])]) if (o?.join) needed.add(o.join)
      }
    }
    expect([...needed].filter((id) => !namedNpcs.find((n) => n.id === id)!.no_attack)).toEqual([])
    for (const id of ['npc_lorenzo_valois', 'npc_anastasia', 'npc_alexei', 'npc_alexander']) expect(namedNpcs.find((n) => n.id === id)!.no_attack, id).toBe(true)
  })

  it('splits the NTR branch of Aya into its own tagged option and quest', () => {
    const want = story('aya_harbor').nodes.find((n) => n.id === 'want')!
    expect(want.options!.map((o) => o.tags ?? [])).toEqual([[], ['ntr']])
    expect(story('aya_ebony_club').tags).toEqual(['adult', 'ntr'])
    expect(story('aya_ebony_club').start.requires?.flags).toEqual(['aya_ntr'])
    expect(story('aya_last_confession').start.requires?.flags).toEqual(['aya_pc'])
    const state = game()
    state.party[0]!.level = 11
    state.guild = { rank: 'B', merit: 0 }
    state.relationships = { ...state.relationships, npc_aya: { affinity: 40 } as never }
    setFlag(state, 'aya_ntr')
    expect(canStart(state, story('aya_ebony_club'))).toBe(true)
    setContentFilters({ ntr: false })
    expect(canStart(state, story('aya_ebony_club'))).toBe(false)
  })
})

describe('stories whose tag is filtered out', () => {
  it('pause their nodes and pick up where they left off when the filter is turned back on', async () => {
    const { activeNodes, startStory, storyPaused } = await import('@/engine/story')
    const { enterLocation } = await import('@/engine/grid')
    const state = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 1, birthplace: 'rivervale' })
    enterLocation(state)
    startStory(state, 'inn_skirt')
    const nodes = () => activeNodes(state).filter((n) => n.def.id === 'inn_skirt')
    expect(storyPaused(state, story('inn_skirt'))).toBe(false)
    expect(nodes().length).toBeGreaterThan(0)
    setContentFilters({ male_partner: false })
    expect(storyPaused(state, story('inn_skirt'))).toBe(true)
    expect(nodes()).toEqual([])
    expect(state.stories!.inn_skirt!.status).toBe('active')
    setContentFilters({ male_partner: true })
    expect(nodes().length).toBeGreaterThan(0)
  })
})

describe('serena ransom', () => {
  it('offers only the payment the councillor agreed to', () => {
    const ransom = story('serena_sea').nodes.find((n) => n.id === 'ransom')!
    expect(ransom.options!.map((o) => o.requires?.flags)).toEqual([['ser_price'], ['ser_free_deal']])
    const [bargain] = story('serena_councillor').nodes.filter((n) => n.id === 'bargain')
    const flags = bargain!.options!.flatMap((o) => [o.success, o.fail]).filter(Boolean).map((o) => o!.set_flags!.find((f) => f !== 'ser_2_done'))
    expect(new Set(flags)).toEqual(new Set(['ser_price', 'ser_free_deal']))
  })
})

describe('quests inside a temporary map', () => {
  it('go in with their own side map and never leave a fight there without an outcome', () => {
    for (const id of ['seacave_low_tide', 'seacave_siren', 'seacave_drowned_crew']) {
      const st = story(id)
      expect(st.nodes[0]!.success!.side_map, id).toBe('cave')
      for (const n of st.nodes.slice(1)) {
        expect(n.at.where, `${id}:${n.id}`).toBe('side')
        expect(n.urgent, `${id}:${n.id}`).toBe(true)
        if (n.kind === 'combat') expect(n.fail, `${id}:${n.id}`).toBeTruthy()
      }
    }
  })

  it('gives the non-adult character lines a fourth, adult quest, one per partner, tagging traditional men', () => {
    const fourth = stories.filter((s) => /・四）$/.test(s.summary) && s.nodes.some((n) => n.id === 'night'))
    // 礁光柱維修沒有：主角是螺鈿婆婆，櫻汐已經有自己的故事線
    expect(fourth.length).toBe(23)
    expect(new Set(fourth.map((s) => s.start.npc)).size).toBe(23)
    expect(fourth.some((s) => s.summary.includes('礁光柱維修'))).toBe(false)
    for (const s of fourth) {
      expect(s.tags?.[0], s.id).toBe('adult')
      expect(s.start.min_affinity, s.id).toBe(40)
      expect(s.start.requires?.flags_any?.length, s.id).toBeGreaterThan(0)
      // 前一個任務（同一條線的三）的結局旗標
      const line = s.summary.match(/（(.+)・四）$/)![1]!
      const third = stories.find((x) => x.summary.endsWith(`（${line}・三）`))!
      const ends = third.nodes.flatMap((n) => [n.success, n.fail, ...(n.options ?? []).flatMap((o) => [o.success, o.fail])]).flatMap((o) => o?.set_flags ?? [])
      for (const f of s.start.requires!.flags_any!) expect(ends, `${s.id} ${f}`).toContain(f)
      const male = namedNpcs.find((n) => n.id === s.start.npc)!.gender === 'male'
      expect(s.tags!.includes('male_partner'), s.id).toBe(male)
    }
    expect(fourth.filter((s) => s.tags!.includes('male_partner')).map((s) => s.id).sort()).toEqual(['god_warm_hands', 'nip_desert_bargain', 'valk_ember_night'])
  })

  it('hides quests with a traditional male partner when that filter is off', () => {
    expect(tagsAllowed(['adult', 'male_partner'])).toBe(true)
    setContentFilters({ male_partner: false })
    expect(tagsAllowed(['adult', 'male_partner'])).toBe(false)
    expect(tagsAllowed(['adult'])).toBe(true)
    // 已經接下的任務也暫停，重新打開之後接著進行
    const st = newGame({ name: '艾倫', race: 'human', classId: 'fighter', seed: 1, birthplace: 'rivervale', body: 'fem' })
    expect(storyPaused(st, story('valk_ember_night'))).toBe(true)
    expect(storyPaused(st, story('isab_bet_paid'))).toBe(false)
    setContentFilters({ male_partner: true })
    expect(storyPaused(st, story('valk_ember_night'))).toBe(false)
  })
})
