# 高等級的地下城（Lv.13～20）：填補底層層主（13 級）之後的空缺。docs/DUNGEON_DESIGN.md 第 8 節、docs/LUST_PARK.md 第 8 節。
#
# - 歷史裂縫（history_rift，Lv.13～16）：河谷鎮附近，政治史詩開始時（接下「風暴的前夜」，旗標 pol_start）出現。
#   阿契隆睜眼之前的徵兆：統一戰爭的殘影從時間的裂縫裡漏出來。
# - 歷史迴廊（history_corridor，Lv.17～20）：河谷鎮附近，政治史詩完成時（pol_done）出現。阿契隆第一次睜眼之後留下的遺跡。
# - 禁果庭園（forbidden_garden，Lv.13～16，成人向）：緋夢樂園底下，集滿五個章（park_stamp_*）時入口廣場角落的鐵柵打開。
#   歡愉之龍莉薇婭的目光停留過的遺跡外層。
# - 歡愉秘宮（pleasure_palace，Lv.17～20，成人向）：緋夢樂園史詩（緋夢之下）完成（lpe_done）時打開。遺跡的本體，魅魔的源頭。
#
# 寫進：
#   data/rules/abilities.json  新的怪物技能（hd_ 開頭，接在 lp_encore 後面）
#   data/rules/enemies.json    四座地下城的怪物（hr_、hc_、fg_、pp_ 開頭）、莉薇婭的投影與遭遇表
#   data/rules/items.json      材料與戰利品（接在「緋夢夫人的吊帶襪」後面）
#   data/rules/lewd.json       park：兩座遺跡的專屬戰敗、擬態寶箱（mimics_at）、不蓋集章卡（unstamped）
#   data/world/geography.json  四個地點與兩條路（歷史裂縫、歷史迴廊寫 requires）
#   data/world/maps.json       各層的光線
#   data/world/special_maps.json  入口廣場多兩道往下的鐵柵（通道的 requires）
# 要排在 lust_park_s7.py、lust_s8.py、lust_s9.py 之後（lust_park_s7 會重寫 lewd.json 的 park 與入口廣場）。
# 可以重跑：先拿掉上一次寫進去的東西再寫。怪物的生命與攻擊加成照平衡模擬調過（TUNE），重跑不會改掉。
import json
import re
import sys

sys.path.insert(0, 'worldgen/scripts/elondia')
import lust_park_s7 as s7  # noqa: E402
from lust_park_s7 import remove_block, drop_lines  # noqa: E402
from high_gear31 import DROPS as gear_drops  # noqa: E402

PREFIXES = ('hr_', 'hc_', 'fg_', 'pp_', 'livia_')
STAMPS = list(s7.STAMPS)
PARK_EPIC_DONE = 'lpe_done'

DUNGEONS = {
    'history_rift': {"name": "歷史裂縫", "region": "central", "requires": {"flags": ["pol_start"]},
                     "note": "河谷鎮附近；政治史詩開始時出現（阿契隆睜眼之前的徵兆）"},
    'history_corridor': {"name": "歷史迴廊", "region": "central", "requires": {"flags": ["pol_done"]},
                         "note": "河谷鎮附近；政治史詩完成時出現（阿契隆第一次睜眼之後的遺跡）"},
    'forbidden_garden': {"name": "禁果庭園", "region": "south", "park": s7.PLAZA, "material_series": "pleasure"},
    'pleasure_palace': {"name": "歡愉秘宮", "region": "south", "park": s7.PLAZA, "material_series": "pleasure"},
}
ROUTES = [
    {"a": "rivervale", "b": "history_rift", "days": [1, 1], "mode": "trail"},
    {"a": "rivervale", "b": "history_corridor", "days": [1, 1], "mode": "trail"},
]
# 光線（周邊、淺層、中層、深層）；園區的周邊用不到
LIGHTING = {
    'history_rift': ['daylight', 'daylight', 'lit', 'dark'],
    'history_corridor': ['daylight', 'lit', 'dark', 'lit'],
    'forbidden_garden': ['lit', 'daylight', 'lit', 'dark'],
    'pleasure_palace': ['lit', 'lit', 'dark', 'lit'],
}
# 入口廣場：西南、東南角往下的鐵柵（條件成立才打開，關著時是普通的地板）
GATES = {'forbidden_garden': ((1, 6), {"flags": STAMPS}), 'pleasure_palace': ((9, 6), {"flags": [PARK_EPIC_DONE]})}
PLAZA_DESC_EXTRA = '廣場南邊的兩個角落各有一道上了鎖的鐵柵，底下的石階一路往地底延伸——蜜菈說那是「員工通道」，可是從來沒有人看過員工從那裡進出。'

# ---------------- 新的怪物技能 ----------------
L = lambda dice='1d6', per=3: {"dice": dice, "type": "lust", "scale": {"dice": "1d6", "per": per}}
ABILITIES = [
    {"id": "hd_buzz", "name": "震動", "type": "skill", "classes": ["monster"], "ap": 2, "attr": "dex", "target": "enemy", "resolve": "attack",
     "damage": [{"weapon": True}, L('1d8')], "apply": [{"status": "sensitized", "turns": 2, "on": "hit"}],
     "desc": "貼在身上嗡嗡地震個不停：武器傷害加 1d8 慾望（每 3 級再 +1d6），命中後敏感 2 回合。"},
    {"id": "hd_replay", "name": "重演", "type": "skill", "classes": ["monster"], "ap": 3, "attr": "cha", "target": "random_enemies", "count": 2, "resolve": "attack",
     "damage": [{"weapon": True}], "uses": {"per_combat": 1},
     "desc": "兩百年前的那一擊又重演了一次：隨機兩個目標各吃一次完整的武器傷害。每場戰鬥一次。"},
]

# ---------------- 怪物 ----------------
MOB_XP = {13: 1140, 14: 1270, 15: 1400, 16: 1530, 17: 1660, 18: 1800, 19: 1950, 20: 2100}
BOSS_XP = {14: 2300, 15: 2650, 16: 3000, 17: 3320, 18: 3600, 19: 3900, 20: 4200}
BOSS_HP = {14: 1350, 15: 1450, 16: 1550, 17: 1650, 18: 1750, 19: 1850, 20: 1950}
WEAK_LUST = {"lust": 0.5}
# 平衡模擬調過的生命與攻擊加成（docs/MONSTERS.md「耐打度」；調整方法見 worldgen/balance/monsters.md）
TUNE = {
    "hr_misplaced_scout": {"hp": 93, "off": 1.0},
    "hr_echo_crow": {"hp": 93, "off": 0.95},
    "hr_echo_crossbowman": {"hp": 92},
    "hr_war_steed": {"hp": 91, "off": 2.89},
    "hr_burning_shade": {"hp": 87, "off": 3.67},
    "hr_siege_wreck": {"hp": 100, "off": 3.39},
    "hr_layered_dead": {"hp": 109, "ap": 7, "off": 4},
    "hr_time_shard": {"hp": 112, "off": 2.31},
    "hr_boss_standard_bearer": {"hp": 1228, "off": 5.3},
    "hr_boss_last_castellan": {"hp": 1502, "off": 5.9},
    "hr_boss_unending_battle": {"hp": 1467, "off": 4.7},
    "hc_frozen_crowd": {"hp": 129, "off": 0.75},
    "hc_echo_hound": {"hp": 135, "off": 0.95},
    "hc_dynasty_guard": {"hp": 130, "off": 2.53},
    "hc_petrified_scribe": {"hp": 132, "off": 2.66},
    "hc_ancient_retainer": {"hp": 123},
    "hc_demonlord_beast": {"hp": 124, "ap": 7, "off": 4},
    "hc_gazed_light": {"hp": 124},
    "hc_chronicle_scale": {"hp": 113},
    "hc_boss_nameless_chronicler": {"hp": 1926, "off": 4.7},
    "hc_boss_demon_king_shadow": {"hp": 1868, "off": 5.9},
    "hc_boss_first_glance": {"hp": 1856, "off": 5.9},
    "fg_orchard_serpent": {"hp": 95, "off": 2.1},
    "fg_fruit_eater": {"hp": 93},
    "fg_buzzing_eggs": {"hp": 91, "off": 1.91},
    "fg_soft_tentacle": {"hp": 112, "ap": 7, "off": 3},
    "fg_fruit_nymph": {"hp": 117, "ap": 8, "off": 4},
    "fg_drowned_knight": {"hp": 105, "ap": 8, "off": 4},
    "fg_boss_gardener": {"hp": 1233, "off": 5.9},
    "fg_boss_toybox": {"hp": 1502, "off": 7},
    "fg_boss_forbidden_tree": {"hp": 1434, "off": 6.1},
    "pp_endless_guest": {"hp": 136, "off": 2.46},
    "pp_cup_succubus": {"hp": 133, "off": 3.29},
    "pp_lonely_fancy": {"hp": 138, "ap": 7, "off": 3.37},
    "pp_ascetic": {"hp": 127, "off": 4, "ap": 8},
    "pp_first_succubus": {"hp": 129, "ap": 7, "off": 3.8},
    "pp_scale_wing": {"hp": 119, "off": 2.15},
    "pp_boss_revel_master": {"hp": 1949, "off": 7, "ap": 8},
    "pp_boss_thousand_faces": {"hp": 1995, "off": 7, "ap": 8},
    "pp_boss_succubus_mother": {"hp": 1840, "off": 6.7, "ap": 8},
    "fg_mimic": {"hp": 106, "off": 2.26},
    "pp_mimic": {"hp": 128},
    "livia_projection": {"hp": 1980, "off": 6.8},
}


def weapon_dice(lv, boss):
    if boss:
        return '4d8' if lv <= 15 else '4d10' if lv <= 19 else '4d12'
    return '3d8' if lv <= 14 else '3d10' if lv <= 16 else '3d12'


def attrs(main, lv, boss, **extra):
    a = {"str": 12, "dex": 14, "int": 10, "fai": 12, "cha": 12}
    a.update(extra)
    a[main] = 14 + lv // 2 + (1 if boss else 0)
    return a


def mon(i, name, kind, lv, main, wtype, ab, resist, desc, loot, boss=False, evade=0, dr=2, below=None, money=None, armed=False, rut=False, extra=None):
    e = {"id": i, "name": name, "level": lv, "attrs": attrs(main, lv, boss, **(extra or {})), "hp": BOSS_HP[lv] if boss else 6 * lv + 12,
         "ap": 8 if boss else 6, "weapon": {"dice": weapon_dice(lv, boss), "type": wtype, "attr": main}, "evade": evade, "dr": dr, "abilities": ab}
    if below:
        e["ability_hp_below"] = {below: 40}
    e["resist"] = resist
    e["offense"] = {"all": 3.5 if boss else 5}
    e["xp"] = BOSS_XP[lv] if boss else MOB_XP[lv]
    if money:
        e["money_cc"] = money
    e["loot"] = [({"item": n, "chance": c} if q == 1 else {"item": n, "chance": c, "qty": q}) for n, c, q in loot]
    if armed:
        e["armed"] = True
    if rut:
        e["rut"] = True
    e["desc"] = desc
    e["kind"] = kind
    t = TUNE.get(i)
    if t:
        e["hp"] = t.get("hp", e["hp"])
        if "off" in t:
            e["offense"] = {"all": t["off"]}
        if "ap" in t:
            e["ap"] = t["ap"]
    return e


MAT = {'history_rift': '時隙的碎片', 'history_corridor': '凝固的時光', 'forbidden_garden': '禁果的果汁', 'pleasure_palace': '歡愉的鱗光'}
RARE = {'history_rift': '重演的戰旗殘片', 'history_corridor': '編年的書頁', 'forbidden_garden': '庭園的金蘋果', 'pleasure_palace': '魅魔的初啼'}
TROPHY = {'history_rift': '不肯結束的號角', 'history_corridor': '那一眼的殘光', 'forbidden_garden': '一顆完整的禁果', 'pleasure_palace': '魅魔之母的心跳'}
TEA, OIL = s7.TEA, s7.OIL


def mob_loot(d, lv, top):
    out = [(MAT[d], 0.8, 2 if top else 1)]
    if d in ('forbidden_garden', 'pleasure_palace'):
        out.append((TEA if lv % 2 else OIL, 0.12, 1))
    return out


def boss_loot(d, layer):
    """layer：0 淺層、1 中層、2 深層（最終層主）。第 5～7 級的打造材料、專屬底材的裝備與獨特裝備另外接在後面（high_gear31.py 的 DROPS）"""
    if layer < 2:
        return [(RARE[d], 1, 2 + layer), (MAT[d], 1, 3 + layer)]
    return [(TROPHY[d], 1, 1), (RARE[d], 1, 3)]


UNDEAD = {"poison": -0.5, "necrotic": -0.25, "radiant": 0.25}


def rift():
    D = 'history_rift'
    ml = lambda lv, top=False: mob_loot(D, lv, top)
    return [
        # 周邊（13）
        mon('hr_misplaced_scout', '錯時的斥候', 'spirit', 13, 'dex', 'piercing', ['pin_shot'], {"necrotic": -0.25, "radiant": 0.25},
            '兩百年前統一戰爭的斥候，從時間的裂縫裡走出來，還在找一支早就不存在的部隊；看見活人就當成敵軍的哨兵放箭。', ml(13), evade=1),
        mon('hr_echo_crow', '殘影烏鴉', 'beast', 13, 'dex', 'piercing', ['rend'], {"cold": -0.25, "lightning": 0.25},
            '每一個戰場上空都有的烏鴉。裂縫附近的烏鴉影子比身體慢一拍，啄下去的傷口要過一會兒才流血。', ml(13), evade=2, dr=1),
        # 淺層（13、14）
        mon('hr_echo_crossbowman', '重演的弩手', 'undead', 13, 'dex', 'piercing', ['thorn_volley'], dict(UNDEAD),
            '戰壕裡的弩手，每隔一刻鐘就重新上一次弦、射一次同一個方向——兩百年前敵軍衝鋒的方向。', ml(13), armed=True),
        mon('hr_war_steed', '統一戰爭的戰馬', 'spirit', 14, 'str', 'bludgeoning', ['charge'], {"necrotic": -0.25, "radiant": 0.25, "piercing": 0.25},
            '主人早就死了，馬還在衝鋒。半透明的馬鎧上插滿了斷箭，蹄聲從裂縫的另一頭傳過來。', ml(14), dr=3),
        # 中層（14、15）
        mon('hr_burning_shade', '燒城的火影', 'elemental', 14, 'int', 'fire', ['ember_bolt'], {"fire": -0.75, "cold": 0.5},
            '城池陷落那天的大火留下來的影子，人形，沒有臉；它燒過的地方要等兩百年才會冷。', ml(14), evade=1, dr=1),
        mon('hr_siege_wreck', '攻城弩車的殘骸', 'construct', 15, 'str', 'piercing', ['pin_shot'], {"poison": -1, "piercing": -0.25, "lightning": 0.25},
            '統一戰爭的攻城弩車，木頭早就爛了，裂縫卻讓它一遍又一遍地裝填、發射；弩箭比人還長。', ml(15), evade=-1, dr=5),
        # 深層（15、16）
        mon('hr_layered_dead', '重疊的亡兵', 'undead', 15, 'str', 'slashing', ['bone_chill'], dict(UNDEAD),
            '好幾個時代的士兵疊在同一副身體裡：帝國的板甲、魔族的角、精靈的長弓，一起舉了起來。', ml(15), armed=True, dr=4),
        mon('hr_time_shard', '時間的裂片', 'spirit', 16, 'int', 'force', ['mind_spike'], {"force": -0.5, "thunder": 0.25},
            '從裂縫邊緣剝落的一片「時間」，像一塊會飛的鏡子；照到它的人會看見自己死在兩百年前的戰場上。', ml(16, True), evade=2, dr=1),
        # 層主
        mon('hr_boss_standard_bearer', '被困在那一天的旗手', 'undead', 14, 'str', 'slashing', ['battle_roar', 'charge', 'curse', 'dirge_of_the_dead'], dict(UNDEAD),
            '歷史裂縫淺層的層主：兩百年前那一戰的旗手，旗桿斷了還舉著，帶著戰馬一遍又一遍地衝向同一道戰壕。', boss_loot(D, 0), boss=True, below='dirge_of_the_dead', armed=True, dr=4),
        mon('hr_boss_last_castellan', '陷落那天的守城將軍', 'undead', 15, 'str', 'slashing', ['battle_roar', 'hd_replay', 'death_decree', 'world_pyre'], dict(UNDEAD),
            '歷史裂縫中層的層主：城門破的那一刻他就死了，可是裂縫讓他回到燒著的城牆上，每天再守一次、再輸一次。', boss_loot(D, 1), boss=True, below='world_pyre', armed=True, dr=4, money=[600, 1400]),
        mon('hr_boss_unending_battle', '不肯結束的那一戰', 'spirit', 16, 'cha', 'slashing', ['wraith_wail', 'hd_replay', 'sonic_scream', 'dirge_of_the_dead'], {"necrotic": -0.5, "psychic": -0.25, "radiant": 0.25},
            '歷史裂縫的最終層主：不是一個人，是兩百年前那一整場戰役——號角、戰旗、刀光與吶喊纏成一團，在裂縫的最深處一遍又一遍地開打。學者說這是歷史之龍「回響編年」阿契隆睜眼之前的徵兆：轉折點近了，過去先一步浮了上來；阿契隆讓這裡反覆重演那一戰，所以打散之後，它過一陣子又會重新聚起形體。',
            boss_loot(D, 2), boss=True, below='dirge_of_the_dead', dr=3, money=[900, 2000]),
    ]


def corridor():
    D = 'history_corridor'
    ml = lambda lv, top=False: mob_loot(D, lv, top)
    return [
        # 周邊（17）
        mon('hc_frozen_crowd', '凝固的行人', 'construct', 17, 'str', 'bludgeoning', ['harden'], {"poison": -1, "bludgeoning": -0.25, "thunder": 0.5},
            '那一眼掃過時正好走在街上的人——不是真的人，是那一瞬間被留下來的樣子，像石膏一樣白；有人靠近，它們就照著那一刻的動作揮手、轉身、撞上來。', ml(17), evade=-1, dr=5),
        mon('hc_echo_hound', '回響的獵犬', 'beast', 17, 'dex', 'piercing', ['rend'], {"necrotic": -0.25, "psychic": 0.25},
            '每一個時代的獵犬疊成的影子，吠聲要過一會兒才傳過來；聞得到兩百年前的血。', ml(17), evade=2, dr=2),
        # 淺層（17、18）
        mon('hc_dynasty_guard', '古王朝的禁衛', 'undead', 17, 'str', 'slashing', ['charge'], dict(UNDEAD),
            '統一戰爭之前、早就沒有人記得名字的王朝的禁衛，守著一條通往不存在的王座的長廊。', ml(17), armed=True, dr=5, money=[80, 260]),
        mon('hc_petrified_scribe', '石化的書記官', 'construct', 18, 'int', 'force', ['rune_blast'], {"poison": -1, "force": -0.25, "bludgeoning": 0.25},
            '把一切寫下來的書記官，寫到一半就成了石頭；石筆還在動，寫的是你們的名字。', ml(18), dr=3),
        # 中層（18、19）
        mon('hc_ancient_retainer', '遠古魔族的侍從', 'demon', 18, 'str', 'fire', ['ember_bolt'], {"fire": -0.5, "radiant": 0.25},
            '遠古魔族之王的侍從，角上還纏著那個時代的金鏈；他們聽不懂現在的魔族說的話，只認得舊主人的命令。', ml(18), armed=True, dr=4, money=[100, 300]),
        mon('hc_demonlord_beast', '魔王時代的戰獸', 'beast', 19, 'str', 'piercing', ['wolf_trip'], {"fire": -0.25, "cold": 0.25},
            '遠古魔族騎著上戰場的巨獸，牙比劍長；牠們在現在的大陸上早就絕種了，只剩迴廊裡的這幾頭。', ml(19), dr=4),
        # 深層（19、20）
        mon('hc_gazed_light', '被注視過的光', 'spirit', 19, 'fai', 'radiant', ['sundial_ray'], {"radiant": -0.75, "necrotic": 0.5},
            '那一眼落下的地方留下的光，冷得像月亮；碰到的東西會想起自己最久以前的樣子。', ml(19), evade=2, dr=1),
        mon('hc_chronicle_scale', '編年的鱗片', 'construct', 20, 'str', 'slashing', ['harden'], {"poison": -1, "slashing": -0.25, "force": 0.25},
            '從半空中剝落下來的一片「鱗」——不是真的鱗，是歷史一層一層疊起來的切面，邊緣鋒利得能割開時間。', ml(20, True), dr=6),
        # 層主
        mon('hc_boss_nameless_chronicler', '無名的史官', 'spirit', 18, 'int', 'force', ['rune_blast', 'curse', 'mind_spike', 'arcane_collapse'], {"force": -0.5, "psychic": -0.25, "fire": 0.25},
            '歷史迴廊淺層的層主：記錄了每一個王朝興亡的史官，自己的名字卻早就從自己寫的書裡被刪掉了；長廊的書架是它的身體，一頁一頁地朝闖入者翻過來。', boss_loot(D, 0), boss=True, below='arcane_collapse', dr=3),
        mon('hc_boss_demon_king_shadow', '遠古魔族之王的影子', 'demon', 19, 'cha', 'necrotic', ['curse', 'battle_roar', 'death_decree', 'world_pyre'], {"necrotic": -0.5, "fire": -0.25, "radiant": 0.25},
            '歷史迴廊中層的層主：低語墓穴的皇帝曾和他立下血誓。這裡的不是他本人，是那個時代留下來最濃的一道影子——王座早就沒了，他還坐著。', boss_loot(D, 1), boss=True, below='world_pyre', dr=4, money=[1000, 2400]),
        mon('hc_boss_first_glance', '第一眼的殘光', 'spirit', 20, 'int', 'force', ['mind_spike', 'petrify_gaze', 'wraith_wail', 'mind_shatter'], {"force": -0.5, "radiant": -0.25, "necrotic": 0.25},
            '歷史迴廊的最終層主：歷史之龍「回響編年」阿契隆第一次睜開眼睛時，那一眼落在這裡的殘光。它不是龍，也不看你——只是把那一刻看見的一切，原樣重演給闖進來的人。阿契隆讓迴廊反覆重演那一眼，所以打散之後，它過一陣子又會重新聚起形體。',
            boss_loot(D, 2), boss=True, below='mind_shatter', evade=1, dr=3, money=[1500, 3000]),
    ]


def garden():
    D = 'forbidden_garden'
    ml = lambda lv, top=False: mob_loot(D, lv, top)
    return [
        # 淺層（13、14）
        mon('fg_orchard_serpent', '守園的白蛇', 'beast', 13, 'dex', 'piercing', ['lp_constrict'], {**WEAK_LUST, "cold": 0.25, "poison": -0.25},
            '盤在蘋果樹上的白蛇，信子是粉紅色的；不咬人，只是纏上來、在耳邊吐氣，叫人去摘樹上的果子。', ml(13), evade=1, dr=1, rut=True),
        mon('fg_fruit_eater', '嘗過禁果的人', 'humanoid', 14, 'cha', 'bludgeoning', ['m_lust_kiss'], {"lust": 0.25, "psychic": -0.25},
            '三百年來每一個走進庭園、咬了一口禁果的人。他們從此不老也不離開，臉頰泛紅、眼神迷濛，看見新的客人就笑著貼上來，要分你一口。', ml(14), armed=True, money=[60, 200]),
        # 中層（14、15）：不屬於這個世界的玩具
        mon('fg_buzzing_eggs', '嗡嗡作響的粉紅蛋', 'construct', 14, 'dex', 'bludgeoning', ['hd_buzz'], {"lightning": 0.5, "poison": -1, "lust": -0.5},
            '一群拳頭大小、粉紅色的蛋，表面光滑得不像任何礦石或陶土，沒有符文也沒有魔力，卻自己嗡嗡地震動、跳來跳去。這個世界的工匠做不出這種東西——學者說，那是歡愉之龍莉薇婭在場的痕跡。', ml(14), evade=2, dr=1),
        mon('fg_soft_tentacle', '軟得不像肉的觸手', 'construct', 15, 'str', 'bludgeoning', ['lp_vine_pull'], {"fire": 0.5, "poison": -1, "lust": -0.5},
            '一根肉色的、軟得像肉又不是肉的東西，摸起來滑溜溜的，帶著一股奇怪的甜味。沒有人說得出它是用什麼做的——不屬於這個世界的材質。', ml(15), dr=2),
        # 深層（15、16）
        mon('fg_fruit_nymph', '禁果的果精', 'fey', 15, 'cha', 'psychic', ['lp_dream'], {**WEAK_LUST, "cold": 0.25, "psychic": -0.25},
            '從裂開的禁果裡爬出來的果精，赤裸的身體上沾著果汁；她身上的果香會讓人忘記自己為什麼來。', ml(15), evade=2, dr=1, rut=True),
        mon('fg_drowned_knight', '沉溺的騎士', 'humanoid', 16, 'str', 'slashing', ['lp_rut_charge'], {"lust": 0.25, "radiant": -0.25},
            '三百年前奉命來燒掉庭園的聖殿騎士。他到現在還穿著盔甲，只是頭盔裡的臉已經醉得通紅，劍上纏滿了開花的藤蔓。', ml(16, True), armed=True, dr=4, rut=True),
        # 層主
        mon('fg_boss_gardener', '庭園的園丁「蜜之手」', 'demon', 14, 'cha', 'piercing', ['m_lust_gaze', 'lp_vine_pull', 'h_aphro_incense', 'lp_lust_tide'], {"lust": 0.25, "radiant": 0.25, "fire": -0.25},
            '禁果庭園淺層的層主：替庭園澆了三百年水的魅魔園丁，手上沾滿了果汁，摸過的地方都會開出花來；守著往下的石階，不讓客人走得太深——走得太深的客人，就不會回去了。', boss_loot(D, 0), boss=True, below='lp_lust_tide', dr=2),
        mon('fg_boss_toybox', '庭園的玩具箱', 'construct', 15, 'str', 'bludgeoning', ['lp_swallow', 'hd_buzz', 'm_aphro_grip', 'lp_lust_tide'], {"lightning": 0.5, "poison": -1, "lust": -0.5},
            '禁果庭園中層的層主：一只比馬車還大的箱子，蓋子一開一闔，裡面塞滿了粉紅色、紫色、會發亮又會動的東西——全都是這個世界不該有的玩具。緋夢樂園寶箱裡那些怪東西，很多是從這裡偷搬上去的。', boss_loot(D, 1), boss=True, below='lp_lust_tide', dr=4),
        mon('fg_boss_forbidden_tree', '禁果之樹', 'plant', 16, 'cha', 'bludgeoning', ['lp_honey', 'lp_vine_pull', 'acid_lance', 'lp_lust_tide'], {**WEAK_LUST, "fire": 0.25, "bludgeoning": -0.25},
            '禁果庭園的最終層主：庭園正中央的那棵樹。據說歡愉之龍莉薇婭的目光曾在這裡停留過一瞬，那一瞬裡被創造出來的愉悅結成了第一顆果子，樹從此只長禁果。砍倒之後，它過一陣子又會從根上重新長起來。', boss_loot(D, 2), boss=True, below='lp_lust_tide', dr=3),
    ]


def palace():
    D = 'pleasure_palace'
    ml = lambda lv, top=False: mob_loot(D, lv, top)
    return [
        # 淺層（17、18）：宴會廳
        mon('pp_endless_guest', '永不散場的賓客', 'spirit', 17, 'cha', 'psychic', ['m_lust_kiss'], {"lust": 0.25, "necrotic": -0.25, "radiant": 0.25},
            '通宵狂歡裡的賓客，戴著不同時代的面具；宴會從來沒有結束過，他們也就從來沒有回家。', ml(17), evade=1, dr=1),
        mon('pp_cup_succubus', '斟酒的魅魔', 'demon', 18, 'cha', 'fire', ['m_lust_gaze'], {"lust": 0.25, "fire": -0.25, "radiant": 0.25},
            '在宴會廳裡穿梭的魅魔，托盤上的酒杯永遠是滿的；喝過她倒的酒，就會想再喝一杯、再留一夜。', ml(18), evade=2, dr=1),
        # 中層（18、19）：密室
        mon('pp_lonely_fancy', '密室裡的妄想', 'spirit', 18, 'int', 'psychic', ['lp_dream'], {"psychic": -0.5, "radiant": 0.25},
            '只有當事人才「看得見」的綺麗幻夢——某個人蜷在陋室裡想過的事，在這裡長出了形體，還記得那個人最喜歡被怎麼碰。', ml(18), evade=2, dr=1),
        mon('pp_ascetic', '偷嘗甘甜的苦修者', 'humanoid', 19, 'fai', 'bludgeoning', ['h_aphro_incense', 'charge'], {"lust": 0.25, "radiant": -0.25, "necrotic": 0.25},
            '一輩子只喝清水的苦修者，在一啜清水裡嘗到了一絲甜——就那一絲，讓他走進了秘宮，再也沒有出來。他還穿著麻衣，只是麻衣底下什麼也沒穿。', ml(19), armed=True, dr=3),
        # 深層（19、20）：鱗光的寢殿
        mon('pp_first_succubus', '最初的魅魔', 'demon', 19, 'cha', 'psychic', ['m_lust_kiss', 'mind_spike'], {"lust": 0.25, "fire": -0.25, "radiant": 0.25},
            '這個世界上最早的一批魅魔。她們不是被生下來的——是「愉悅被創造出來的那一瞬間」在莉薇婭的目光下長成了形體；後來所有的魅魔，都是她們的女兒。', ml(19), evade=2, dr=1),
        mon('pp_scale_wing', '鱗光的薄翼', 'spirit', 20, 'dex', 'radiant', ['blur_veil'], {"radiant": -0.5, "necrotic": 0.25},
            '半空中舞動的一片薄翼似的裙裾，鱗光一閃一閃——人們在狂歡的酒香燈影裡「隱約看見」的，就是這個。它不是龍，只是龍經過時留下的光。', ml(20, True), evade=3, dr=1),
        # 層主
        mon('pp_boss_revel_master', '狂歡的司儀', 'demon', 18, 'cha', 'psychic', ['lp_encore', 'sonic_scream', 'mind_spike', 'lp_lust_tide'], {"lust": 0.25, "fire": -0.25, "radiant": 0.25},
            '歡愉秘宮淺層的層主：主持這場宴會的司儀，從宴會開始的那一晚就沒有停過嘴；誰想離席，他就把全場的目光都引到那個人身上。', boss_loot(D, 0), boss=True, below='lp_lust_tide', evade=1, dr=2),
        mon('pp_boss_thousand_faces', '千面的夢魔', 'demon', 19, 'cha', 'psychic', ['lp_dream', 'm_lust_kiss', 'death_decree', 'lp_lust_tide'], {"lust": 0.25, "psychic": -0.5, "radiant": 0.25},
            '歡愉秘宮中層的層主：沒有自己的臉——看著它的人，看見的是自己最想要的那一張。密室裡每一個人的妄想，它都戴過。', boss_loot(D, 1), boss=True, below='lp_lust_tide', evade=2, dr=1),
        mon('pp_boss_succubus_mother', '魅魔之母', 'demon', 20, 'cha', 'psychic', ['m_lust_kiss', 'death_decree', 'mind_spike', 'lp_lust_tide'], {"lust": 0.25, "fire": -0.5, "radiant": 0.25},
            '歡愉秘宮的最終層主：第一個魅魔。莉薇婭的目光在這座宮殿停留得最久，凡人的愉悅在那段時間裡一層一層地堆起來，最後堆成了她——所有魅魔的源頭。她不懂得悲傷，也不懂得飽足；打倒之後，宮殿裡的愉悅會再一次把她堆起來。', boss_loot(D, 2), boss=True, below='lp_lust_tide', evade=2, dr=2),
    ]


def extras():
    """擬態寶箱（不在遭遇表裡）與巨龍史詩的頭目"""
    return [
        mon('fg_mimic', '禁果的偽箱', 'beast', 15, 'str', 'bludgeoning', ['lp_tongue_lash'], {"lust": 0.5, "fire": 0.25, "piercing": -0.25},
            '長得和庭園裡的寶箱一模一樣，蓋子上還雕著蘋果；打開的瞬間伸出一條帶著果香的長舌頭。', [(TEA, 0.5, 1), (OIL, 0.5, 1), ('《極樂秘典》', 0.06, 1)], money=[200, 600]),
        mon('pp_mimic', '秘宮的寶匣魅魔', 'demon', 19, 'cha', 'psychic', ['lp_tongue_lash', 'm_lust_gaze'], {"lust": 0.25, "fire": -0.25, "radiant": 0.25},
            '縮在寶匣裡的魅魔，等著被人打開——她說這是秘宮最古老的玩法。', [(TEA, 0.5, 1), (OIL, 0.5, 1), ('《傾國》', 0.06, 1)], money=[400, 1000]),
        mon('livia_projection', '莉薇婭的投影', 'spirit', 20, 'cha', 'psychic', ['m_lust_gaze', 'mind_spike', 'death_decree', 'lp_lust_tide'], {"lust": -0.5, "psychic": -0.25, "necrotic": 0.25},
            '歡愉之龍「眾歡獨樂」莉薇婭的投影：沒有固定的形體——酒香燈影裡的曼妙鱗光、薄翼般舞動的裙裾，一下是萬人的狂歡，一下又縮成某個人腦海深處的一場綺夢。祂不看你，也不知道你在這裡；祂只是停在這座宮殿裡，看著每一個凡人覺得快樂的那一瞬間。（特殊任務「眾歡獨樂」）',
            [], boss=True, below='lp_lust_tide', evade=2, dr=2),
    ]


def encounters(groups):
    out = {}
    for d, m in groups.items():
        ids = [x['id'] for x in m]
        if d in ('forbidden_garden', 'pleasure_palace'):
            b1, b2, c1, c2, d1, d2, bs, bm, bd = ids
            outskirts = []
        else:
            a1, a2, b1, b2, c1, c2, d1, d2, bs, bm, bd = ids
            outskirts = [[[a1, 2]], [[a2, 2]], [[a1, 1], [a2, 1]]]
        enc = {"outskirts": outskirts} if outskirts else {"outskirts": []}
        enc["shallow"] = [[[b1, 2]], [[b2, 2]], [[b1, 1], [b2, 1]], [[b2, 1], [b1, 1]]] + ([[[b1, 1], [a2, 1]]] if outskirts else [])
        enc["middle"] = [[[c1, 2]], [[c2, 2]], [[c1, 1], [c2, 1]], [[c1, 1], [b2, 1]]]
        enc["deep"] = [[[d1, 2]], [[d2, 2]], [[d1, 1], [d2, 1]], [[d1, 1], [c2, 1]]]
        enc["boss"] = [[bd, 1], [d1, 1]]
        enc["bosses"] = {"shallow": [[bs, 1], [b1, 1]], "middle": [[bm, 1], [c1, 1]], "deep": [[bd, 1], [d1, 1]]}
        out[d] = enc
    return out


# ---------------- 物品 ----------------
def material(name, price, desc, adult=False):
    x = {"name": name, "category": "material", "price_cc": price, "tags": []}
    if adult:
        x["adult"] = True
    x["desc"] = desc
    return x


ITEMS = [
    material('時隙的碎片', 180, '歷史裂縫裡撿到的透明碎片，裡面封著一小段兩百年前的畫面：一面旗、一聲號角、一個回頭的人。'),
    material('重演的戰旗殘片', 900, '統一戰爭的戰旗殘片，放下之後過一會兒又會自己飄起來，像是還在風裡。'),
    material('不肯結束的號角', 2600, '「不肯結束的那一戰」散去之後留下的號角，沒有人吹，偶爾還是會響一聲。'),
    material('凝固的時光', 280, '歷史迴廊裡的一小塊光，摸起來是硬的；握在手裡的時候，周圍的聲音會慢下來。'),
    material('編年的書頁', 1300, '從無名史官身上撕下來的書頁，字還在一個一個地寫上去——寫的是現在發生的事。'),
    material('那一眼的殘光', 3600, '阿契隆那一眼留下的一點光，裝在瓶子裡也不會暗；看久了，會想起自己忘掉的事。'),
    material('禁果的果汁', 190, '禁果庭園的果子擠出來的汁，甜得發膩，聞一下就臉紅；鍊金師拿來調最烈的媚藥。', adult=True),
    material('庭園的金蘋果', 950, '園丁「蜜之手」親手摘的金色蘋果，咬一口據說能讓人一整晚都不知道累。', adult=True),
    material('一顆完整的禁果', 2600, '禁果之樹上結的果子，完整、沒有被咬過；三百年來，沒有人能忍住不咬，所以這一顆特別值錢。', adult=True),
    material('歡愉的鱗光', 300, '歡愉秘宮裡飄落的一點鱗光，貼在皮膚上會暖暖地發亮，讓人想起最快樂的那一刻。', adult=True),
    material('魅魔的初啼', 1400, '最古老的魅魔吐出的第一聲嘆息凝成的珠子；魅魔們願意拿任何東西來換。', adult=True),
    material('魅魔之母的心跳', 3800, '魅魔之母散去時留下的一顆溫熱的光，一跳一跳的，和握著它的人的心跳慢慢變成同一個節奏。', adult=True),
]


# ---------------- 園區的規則 ----------------
DEFEATS = {
    'forbidden_garden': {
        "scene": "主角在禁果庭園倒下，被嘗過禁果的人們抬到果樹下，一口一口地餵禁果：果汁從嘴角流到胸口，每咬一口身體就更熱，庭園的住客們圍上來一起「分享」，一直到主角自己也笑著求他們再餵一顆",
        "summary": "在禁果庭園被餵了一整晚的禁果，醒來時渾身果香，躺在入口廣場的鐵柵旁邊。",
        "effects": [{"type": "condition", "target": "pc", "condition": "aroused", "add": True}, {"type": "lewd", "stat": "lewdness", "delta": 3}, {"type": "lewd", "stat": "sensitivity", "delta": 2}],
        "hours": 12},
    'pleasure_palace': {
        "scene": "主角在歡愉秘宮倒下，被最初的魅魔們抬進宴會廳的正中央，成了這場永不散場的宴會今晚的「主菜」：賓客、魅魔與夢魔輪流享用主角，鱗光在頭頂一閃一閃，主角在一次又一次的高潮裡忘了時間",
        "summary": "成了秘宮宴會一整天的「主菜」，被送回入口廣場時已經是第二天的傍晚；身上還留著鱗光的痕跡。",
        "effects": [{"type": "condition", "target": "pc", "condition": "aroused", "add": True}, {"type": "lewd", "stat": "lewdness", "delta": 3}, {"type": "lewd", "stat": "submission", "delta": 3}],
        "hours": 20},
}
MIMICS_AT = {'forbidden_garden': {"1": "fg_mimic", "2": "fg_mimic", "3": "fg_mimic"}, 'pleasure_palace': {"1": "pp_mimic", "2": "pp_mimic", "3": "pp_mimic"}}


def park_block(old):
    rules = dict(old)
    rules["mimics_at"] = MIMICS_AT
    rules["unstamped"] = ['forbidden_garden', 'pleasure_palace']
    defeats = {k: v for k, v in old["defeats"].items() if k not in DEFEATS}
    defeats.update(DEFEATS)
    rules["$comment"] = rules["$comment"].split('（緋夢樂園底下的遺跡')[0] + '（緋夢樂園底下的遺跡：mimics_at 是個別園區自己的擬態寶箱，unstamped 是不蓋集章卡的園區）'
    order = [k for k in rules if k != 'defeats'] + ['defeats']
    inner = ',\n'.join(f'    "{k}": {json.dumps(rules[k], ensure_ascii=False)}' for k in order if k != 'defeats')
    rows = ',\n'.join(f'      "{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in defeats.items())
    return f'  "park": {{\n{inner},\n    "defeats": {{\n{rows}\n    }}\n  }}'


def all_monsters():
    groups = {'history_rift': rift(), 'history_corridor': corridor(), 'forbidden_garden': garden(), 'pleasure_palace': palace()}
    # 層主的高階打造材料、專屬底材的裝備與獨特裝備（high_gear31.py）
    drops = gear_drops()
    for e in [m for g in groups.values() for m in g]:
        for n, c, q in drops.get(e['id'], []):
            e['loot'].append({"item": n, "chance": c} if q == 1 else {"item": n, "chance": c, "qty": q})
    return groups, extras()


def write():
    groups, more = all_monsters()
    monsters = [e for g in groups.values() for e in g] + more
    prefix_re = '(?:' + '|'.join(PREFIXES) + ')'
    # 技能
    p = 'data/rules/abilities.json'
    t = open(p).read()
    t = drop_lines(t, r'\n    \{"id": "hd_[^"]+".*')
    anchor = re.search(r'\n    \{"id": "lp_encore".*', t)
    line = anchor.group(0)
    t = t[:anchor.start()] + line.rstrip(',') + ',\n' + ',\n'.join('    ' + json.dumps(a, ensure_ascii=False) for a in ABILITIES) + (',' if line.endswith(',') else '') + t[anchor.end():]
    json.loads(t)
    open(p, 'w').write(t)
    # 怪物與遭遇表
    p = 'data/rules/enemies.json'
    t = open(p).read()
    t = drop_lines(t, r'\n    \{"id": "' + prefix_re + r'[^"]+".*')
    for d in DUNGEONS:
        t = remove_block(t, r'\n    "' + d + r'": \{')
    i = t.index('\n  ],\n  "encounters"')
    head = t[:i].rstrip()
    if not head.endswith(','):
        head += ','
    t = head + '\n' + ',\n'.join('    ' + json.dumps(e, ensure_ascii=False) for e in monsters) + t[i:]
    i = t.index('\n  },\n  "wild_encounters"')
    blocks = []
    for d, enc in encounters(groups).items():
        lines = [f'      "{k}": {json.dumps(v, ensure_ascii=False)}' for k, v in enc.items()]
        blocks.append(f'    "{d}": {{\n' + ',\n'.join(lines) + '\n    }')
    t = t[:i] + ',\n' + ',\n'.join(blocks) + t[i:]
    json.loads(t)
    open(p, 'w').write(t)
    # 物品
    p = 'data/rules/items.json'
    t = open(p).read()
    for n in [x['name'] for x in ITEMS]:
        t = drop_lines(t, r'\n    \{"name": ' + re.escape(json.dumps(n, ensure_ascii=False)) + r'.*')
    anchor = re.search(r'\n    \{"name": "緋夢夫人的吊帶襪".*', t)
    line = anchor.group(0)
    t = t[:anchor.start()] + line.rstrip(',') + ',\n' + ',\n'.join('    ' + json.dumps(x, ensure_ascii=False) for x in ITEMS) + (',' if line.endswith(',') else '') + t[anchor.end():]
    json.loads(t)
    open(p, 'w').write(t)
    # 園區的規則
    p = 'data/rules/lewd.json'
    t = open(p).read()
    old = json.loads(t)['park']
    t = remove_block(t, r'\n  "park": \{')
    t = t.rstrip().rstrip('}').rstrip() + ',\n' + park_block(old) + '\n}\n'
    json.loads(t)
    open(p, 'w').write(t)
    # 地點與路線
    p = 'data/world/geography.json'
    t = open(p).read()
    for d in DUNGEONS:
        t = drop_lines(t, r'\n    \{ "id": "' + d + r'".*')
        t = drop_lines(t, r'\n    \{ "a": "[a-z_]+", "b": "' + d + r'".*')
    anchor = re.search(r'\n    \{ "id": "park_theater".*', t)
    line = anchor.group(0)
    rows = []
    for d, v in DUNGEONS.items():
        loc = {"id": d, "name": v["name"], "region": v["region"], "type": "dungeon"}
        for k in ('park', 'requires', 'material_series', 'note'):
            if k in v:
                loc[k] = v[k]
        rows.append('    { ' + json.dumps(loc, ensure_ascii=False)[1:-1] + ' }')
    t = t[:anchor.start()] + line.rstrip(',') + ',\n' + ',\n'.join(rows) + (',' if line.endswith(',') else '') + t[anchor.end():]
    i = t.index('\n  ]', t.index('"routes"'))
    head = t[:i].rstrip()
    t = head + ',\n' + ',\n'.join('    { ' + json.dumps(r, ensure_ascii=False)[1:-1] + ' }' for r in ROUTES) + t[i:]
    json.loads(t)
    open(p, 'w').write(t)
    # 光線
    p = 'data/world/maps.json'
    t = open(p).read()
    for d in DUNGEONS:
        t = re.sub(r'\n      "' + d + r'": \[.*', '', t)
    anchor = re.search(r'\n      "mist_abbey": \[.*', t)
    t = t[:anchor.start()] + '\n' + '\n'.join(f'      "{k}": {json.dumps(v)},' for k, v in LIGHTING.items()) + t[anchor.start():]
    json.loads(t)
    open(p, 'w').write(t)
    # 入口廣場：多兩道往下的鐵柵
    p = 'data/world/special_maps.json'
    t = open(p).read()
    t = remove_block(t, r'\n    "' + s7.PLAZA + r'": \{')
    block = s7.plaza_block()
    extra = [{"at": {"x": x, "y": y}, "to": {"area": f"dungeon/{d}", "x": 0, "y": 0}, "requires": req} for d, ((x, y), req) in GATES.items()]
    k = block.index('\n      ],\n      "shops"')
    block = block[:k] + ',\n' + ',\n'.join('        ' + json.dumps(c, ensure_ascii=False) for c in extra) + block[k:]
    block = block.replace('發集章卡給新來的客人。"', '發集章卡給新來的客人。' + PLAZA_DESC_EXTRA + '"')
    end = t.rstrip().rstrip('}').rstrip()
    end = end[:-1].rstrip()
    t = end + ',\n' + block + '\n  }\n}\n'
    json.loads(t)
    open(p, 'w').write(t)
    print('monsters', len(monsters), 'abilities', len(ABILITIES), 'items', len(ITEMS))


# ---------------- 世界書 ----------------
# 兩個新條目（關鍵字觸發；54 是成人向，src/narrator/lore.ts 的 ADULT 要有它），並在「高維巨龍」補上歡愉之龍的推測與關注凡人的順序。
WB_ENTRIES = {
    53: ("地下城-历史裂缝与历史回廊", ["历史裂缝", "历史回廊", "歷史裂縫", "歷史迴廊"],
         "地下城-历史裂缝与历史回廊（河谷镇附近）:\n"
         "  历史裂缝: '政治斗争走向终局之前，出现在河谷镇外一天路程的平原上：时间的裂缝里漏出两百年前统一战争的残影——错时的斥候、重演的弩手、燃烧的城墙、不肯结束的那一战。学者说这是历史之龙「回响编年」阿契隆睁眼之前的征兆：转折点近了，过去先一步浮了上来。'\n"
         "  历史回廊: '阿契隆第一次睁眼之后留下的遗迹，同样在河谷镇外一天路程：一层是一个时代——凝固的街道（那一眼扫过时被留下来的行人）、古王朝的长廊、远古魔族之王的大厅、眼睛看过的地方。最深处是「第一眼的残光」：它不是龙，只是把那一刻看见的一切原样重演。'\n"
         "  共通: '两座都会反复重演，打倒的层主过一阵子又会重新聚形；阿契隆不会察觉闯进来的人。'"),
    54: ("遗迹-禁果庭园与欢愉秘宫", ["禁果庭园", "欢愉秘宫", "禁果庭園", "歡愉秘宮", "魅魔的源头", "魅魔的源頭"],
         "欢愉之龙的遗迹（绯梦乐园底下）:\n"
         "  禁果庭园: '绯梦乐园入口广场西南角的铁栅底下：地底的果园，天顶亮如白昼，只长禁果。据说欢愉之龙莉薇娅的目光曾在这里停留过一瞬，那一瞬里被创造出来的愉悦结成了第一颗果子；咬过禁果的人从此不老也不离开。中层堆满了不属于这个世界的玩具——会震动的粉红蛋、软得像肉又不是肉的触手——绯梦乐园宝箱里那些怪东西，很多是从这里搬上去的。绯梦夫人三百年前在庭园旁盖了乐园，魅魔靠近这里就觉得像回到家。'\n"
         "  欢愉秘宫: '禁果之树的树根底下、入口广场东南角的铁栅通往的遗迹本体：一场从来没有结束过的宴会、一间间只容一人的密室、鳞光闪烁的寝殿。莉薇娅的目光在这里停留得最久，凡人的愉悦一层层堆起来，长成了最初的魅魔——所有魅魔的源头；最深处是魅魔之母。'\n"
         "  传说: '密室墙上的刻文旁有人补了一句：那些不属于这个世界的玩具，也许是莉薇娅从比祂更近的那双眼睛那一边借来的。'"),
}
WB_DRAGON = ("  - 欢愉之龙: '在乎的不是纵欲，而是每一个凡人「觉得快乐」的那一瞬间——喧闹的、孤独的、克制的都一样，一个也不放过；祂看得太近时，快乐会停不下来。最初的魅魔，据说就是凡人的快乐在祂目光下长成的形体。'\n"
             "  关注凡人的顺序: '七条龙里最在乎凡人的是观者之龙，祂的眼睛无所不在；其次是欢愉之龙；第三才是历史之龙，只在转折点睁一次眼；其他的龙根本不知道凡人存在。（欢愉秘宫密室里的刻文）'")


def write_worldbook():
    p = 'data/worldbook/elondia.worldbook.json'
    w = json.load(open(p, encoding='utf-8'))
    ents = w['entries']
    template = ents['52']
    for uid, (comment, keys, content) in WB_ENTRIES.items():
        e = dict(template)
        e.update({"uid": uid, "key": keys, "comment": comment, "content": content, "order": 450 + uid, "displayIndex": uid, "constant": False})
        ents[str(uid)] = e
    dragon = ents['45']
    if '欢愉之龙: ' not in dragon['content']:
        dragon['content'] = dragon['content'].rstrip('\n') + '\n' + WB_DRAGON
    open(p, 'w', encoding='utf-8').write(json.dumps(w, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    write()
    write_worldbook()
