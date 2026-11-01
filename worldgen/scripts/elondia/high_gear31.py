# 高等地下城的裝備（docs/plan/roadmap/HIGH_DUNGEONS_PLAN.md 第 2 節；docs/ITEMS.md 第 4.5 節）：
#
# - 第 6、7 級材料分兩套，各五種類型：歷史系列（歷史裂縫第 6 級、歷史迴廊第 7 級）、歡愉系列（禁果庭園第 6 級、歡愉秘宮第 7 級，成人向）。
#   每一座地下城的層主都掉得到自己那一套、那一級的全部五種。
# - 打造延伸到第 7 級：工錢、DC、工藝等級上限 7、首都工匠的等級 4～7、工具（第 6、7 級要房子的工作台）。
# - 一般底材 9 種（雙手劍、長戟、長槍、弩、長鞭、塔盾、格擋短劍、魔導書、鱗甲）：商店、打造、隨機裝備都有。
# - 地下城專屬的底材 10 種（exclusive）：四座的層主各掉一件做好的，不能打造、不在商店與寶箱。
# - 傳說的獨特裝備 8 件：補上沒有的副手、頭、腿、鞋、腰帶，手腕與腿飾各多一件；放在四座的層主身上。
#
# 寫進：data/rules/gear.json（材料、底材、打造的工錢與 DC）、data/rules/crafts.json（工藝等級、工具、工匠等級）、
#       data/rules/equipment.json（新的武器與上身防具類型）、data/rules/items.json（打造材料、制式裝備、專屬底材的裝備、獨特裝備）。
# 層主的掉落由 high_dungeons31.py 讀這裡的 DROPS。要排在 high_dungeons31.py 之前（它會讀 items.json 確認物品存在）。
# 可以重跑：先拿掉上一次寫進去的東西再寫。
import json
import re

# ---------------- 材料 ----------------
# 兩套材料：歷史系列（歷史裂縫第 6 級、歷史迴廊第 7 級）與歡愉系列（禁果庭園第 6 級、歡愉秘宮第 7 級），各有五種類型。
# 同一級的兩套加成一樣，差在防具加成與抗性：歷史系列厚重（減傷、暗影與心靈抗性），歡愉系列輕巧（迴避、慾望抗性）。
# 隨機裝備（寶箱、人形怪物）同一級有兩套時，依地點的 material_series 挑（緋夢樂園底下的遺跡開歡愉系列），其他地方用排在前面的歷史系列。
# 第 6 級的建議等級 16：Lv.13～16 的地下城最深一層的寶箱開得到。
# id: (系列, 類型, 名稱, 等級, 加成, 建議等級, 價格倍率, 防具加成, 抗性, 描述)
MATERIALS = {
    # 歷史系列
    'riftsteel': ('history', 'metal', '時隙鋼', 6, 8, 16, 1800, {"dr": 2, "evade": 1}, None, '從歷史裂縫的邊緣剝下來的金屬，鍛打的時候聽得見兩百年前的號角。'),
    'chronicle_steel': ('history', 'metal', '編年鋼', 7, 10, 19, 3000, {"dr": 3, "evade": 1}, None, '歷史迴廊裡的「鱗片」熔成的鋼，一層一層疊著不同時代的紋路。'),
    'echo_hide': ('history', 'leather', '回響獸皮', 6, 8, 16, 1800, None, {"necrotic": -0.5}, '統一戰爭的戰獸留在裂縫裡的皮，摸起來還是溫的。'),
    'chronicle_hide': ('history', 'leather', '編年鱗皮', 7, 10, 19, 3000, None, {"necrotic": -0.5, "radiant": -0.25}, '「編年的鱗片」一片片縫成的皮，每一片都是不同時代的切面。'),
    'echoweave': ('history', 'cloth', '殘影織', 6, 8, 16, 1800, None, {"psychic": -0.5}, '用時隙裡的殘影紡成的布，穿上的人看起來總是慢了半拍。'),
    'afterglow_weave': ('history', 'cloth', '殘光織', 7, 10, 19, 3000, None, {"psychic": -0.5, "force": -0.25}, '「那一眼」留下的殘光紡成的布，冷得像月光。'),
    'ringwood': ('history', 'wood', '年輪木', 6, 8, 16, 1800, None, None, '一圈年輪就是一年——這塊木頭有兩百圈，每一圈都是同一場戰役。'),
    'stilltime_wood': ('history', 'wood', '凝時木', 7, 10, 19, 3000, None, None, '那一眼掃過時正在生長的樹，從此停在那一刻，硬得刀劈不進。'),
    'chrono_crystal': ('history', 'jewel', '時晶', 6, 5, 16, 2500, None, None, '裂縫裡結成的晶體，裡面封著一小段會動的過去。'),
    'dragon_eye': ('history', 'jewel', '龍瞳石', 7, 6, 19, 4000, None, None, '像一隻半閉的眼睛的寶石；學者說，它只是看起來像阿契隆的眼睛。'),
    # 歡愉系列
    'alien_alloy': ('pleasure', 'metal', '異鄉合金', 6, 8, 16, 1800, {"dr": 1, "evade": 2}, None, '庭園玩具箱裡那種不屬於這個世界的金屬，輕得不像金屬，摸起來滑溜溜的。'),
    'glimmer_gold': ('pleasure', 'metal', '鱗光金', 7, 10, 19, 3000, {"dr": 1, "evade": 3}, None, '秘宮寢殿的鱗光凝成的金，一閃一閃，像有人在燈影裡跳舞。'),
    'white_serpent_hide': ('pleasure', 'leather', '白蛇皮', 6, 8, 16, 1800, None, {"poison": -0.5, "lust": -0.25}, '守園的白蛇蛻下來的皮，軟得像絲，貼著身體會慢慢變暖。'),
    'glimmer_hide': ('pleasure', 'leather', '鱗光皮', 7, 10, 19, 3000, None, {"fire": -0.5, "lust": -0.5}, '一閃一閃地發著鱗光的皮，誰也說不出是從什麼東西身上來的。'),
    'fruit_gauze': ('pleasure', 'cloth', '禁果紗', 6, 8, 16, 1800, None, {"lust": -0.5}, '禁果之樹的花絲織成的紗，帶著淡淡的果香。'),
    'wingweave': ('pleasure', 'cloth', '薄翼紗', 7, 10, 19, 3000, None, {"psychic": -0.25, "lust": -0.75}, '像薄翼、像裙裾的紗，輕得幾乎感覺不到。'),
    'fruitwood': ('pleasure', 'wood', '禁果木', 6, 8, 16, 1800, None, None, '只長禁果的那棵樹的木頭，削開來是粉紅色的，甜得發膩。'),
    'revel_sandal': ('pleasure', 'wood', '香檀', 7, 10, 19, 3000, None, None, '秘宮宴會廳的樑柱，三百年來的酒香燈影都滲進了木紋裡。'),
    'honey_crystal': ('pleasure', 'jewel', '蜜晶', 6, 5, 16, 2500, None, None, '禁果的汁液凝成的晶體，含在嘴裡會化，戴在身上不會。'),
    'charm_eye': ('pleasure', 'jewel', '魅瞳石', 7, 6, 19, 4000, None, None, '魅魔之母的眼淚凝成的寶石；看著它的人，會覺得被它看著。'),
}
SERIES = {'history': '歷史系列', 'pleasure': '歡愉系列'}
# 打造材料（items.json 的 forge）：每種材料一件；歡愉系列標成人向
FORGE_ITEMS = {
    'riftsteel': ('時隙鋼塊', 60000, '歷史裂縫的層主身上掉下來的金屬塊，表面的紋路一直在變。'),
    'chronicle_steel': ('編年鋼塊', 90000, '歷史迴廊的層主身上掉下來的鋼塊，切面像一本闔起來的書。'),
    'echo_hide': ('回響獸皮', 60000, '統一戰爭的戰獸留下的皮，貼在耳邊聽得見遠遠的蹄聲。'),
    'chronicle_hide': ('編年鱗皮', 90000, '一層層疊著不同時代的鱗皮。'),
    'echoweave': ('殘影織布', 60000, '一捲用殘影紡成的布，攤開來比捲起來的時候慢了半拍。'),
    'afterglow_weave': ('殘光織布', 90000, '一捲冷得像月光的布。'),
    'ringwood': ('年輪木心', 60000, '兩百圈年輪的木心，每一圈都是同一場戰役。'),
    'stilltime_wood': ('凝時木心', 90000, '停在某一刻的木心，摸起來沒有溫度。'),
    'chrono_crystal': ('時晶原石', 90000, '封著一小段過去的原石，對著光看得見裡面的人影在動。'),
    'dragon_eye': ('龍瞳石原石', 130000, '像一隻半閉的眼睛的原石。'),
    'alien_alloy': ('異鄉合金塊', 60000, '從庭園的玩具箱裡拆下來的金屬塊，沒有一道鍛紋。'),
    'glimmer_gold': ('鱗光金塊', 90000, '一閃一閃地發著鱗光的金塊。'),
    'white_serpent_hide': ('白蛇皮', 60000, '守園的白蛇蛻下來的一整張皮。'),
    'glimmer_hide': ('鱗光皮', 90000, '一閃一閃地發著鱗光的皮。'),
    'fruit_gauze': ('禁果紗布', 60000, '一捲帶著果香的紗。'),
    'wingweave': ('薄翼紗布', 90000, '一捲薄得透光的紗，風一吹就像要飛起來。'),
    'fruitwood': ('禁果木心', 60000, '粉紅色的木心，甜得發膩。'),
    'revel_sandal': ('香檀木心', 90000, '滲滿了酒香的木心。'),
    'honey_crystal': ('蜜晶原石', 90000, '琥珀色的原石，聞起來像蜂蜜。'),
    'charm_eye': ('魅瞳石原石', 130000, '像一滴眼淚的原石。'),
}
MAT_BY = {(v[0], v[1], v[3]): k for k, v in MATERIALS.items()}  # (系列, 類型, 等級) → id

# 打造：工錢倍率與 DC 延伸到第 7 級；工藝等級上限 7、經驗、工具；首都工匠的等級
CRAFT_FEE = [1, 2, 3, 4, 5, 6, 7]
CRAFT_DC = [10, 12, 14, 16, 18, 20, 22]
SKILL_MAX = 7
XP_TO_NEXT = [6, 15, 30, 50, 80, 110]
TOOL_TIER = [1, 1, 2, 3, 3, 3, 3]
CAPITAL_LEVELS = [4, 7]

# ---------------- 底材 ----------------
WEAPONS = {
    'greatsword': {"name": "雙手劍", "dice": "2d6", "type": "slashing", "attr": "str", "threat": 0.1},
    'halberd': {"name": "長戟", "dice": "1d10", "type": "slashing", "attr": "str", "threat": 0.05},
    'spear': {"name": "長槍", "dice": "1d8", "type": "piercing", "attr": "str"},
    'crossbow': {"name": "弩", "dice": "1d10", "type": "piercing", "attr": "dex", "threat": -0.15},
    'whip': {"name": "長鞭", "dice": "1d6", "type": "slashing", "attr": "dex", "threat": -0.05},
    # 地下城專屬
    'rift_blade': {"name": "錯時刃", "dice": "1d8", "type": "force", "attr": "dex", "threat": -0.05},
    'banner_spear': {"name": "戰旗長槍", "dice": "1d10", "type": "piercing", "attr": "str", "threat": 0.15},
    'glance_bow': {"name": "殘光長弓", "dice": "1d10", "type": "radiant", "attr": "dex", "threat": -0.1},
    'vine_whip': {"name": "禁果藤鞭", "dice": "1d6", "type": "slashing", "attr": "dex"},
}
ARMORS = {
    'scale': {"name": "鱗甲", "evade": -2, "dr": 3, "resist": {"slashing": -0.25}, "threat": 0.15},
    'echo_mail': {"name": "回響鱗鎧", "evade": -1, "dr": 3, "resist": {"slashing": -0.25, "necrotic": -0.25}, "threat": 0.1},
    'fruit_corset': {"name": "禁果束衣", "evade": 1, "dr": 1, "resist": {"lust": -0.25}},
    'glimmer_veil': {"name": "鱗光薄紗", "evade": 2, "dr": 0, "resist": {"lust": -0.25, "psychic": -0.25}, "threat": -0.1},
}
W = {"damage": "full", "hit": "half"}
BASES = {
    # 一般底材
    'greatsword': {"slot": "main_hand", "name": "雙手劍", "kind": "metal", "weapon": "greatsword", "two_handed": True, "price": 500, "scale": W, "desc": "比人還長的雙手劍，揮起來要整個身體一起轉。"},
    'halberd': {"slot": "main_hand", "name": "長戟", "kind": "metal", "weapon": "halberd", "two_handed": True, "price": 380, "stats": {"hit": 1}, "scale": W, "desc": "斧刃、槍尖與鉤子裝在同一根長柄上，搆得比劍遠。"},
    'spear': {"slot": "main_hand", "name": "長槍", "kind": "wood", "weapon": "spear", "price": 90, "scale": W, "desc": "木柄的長槍，空出一隻手來拿盾。"},
    'crossbow': {"slot": "main_hand", "name": "弩", "kind": "wood", "weapon": "crossbow", "two_handed": True, "price": 400, "stats": {"hit": 1}, "scale": W, "desc": "上弦慢、射得準，不太需要臂力。"},
    'whip': {"slot": "main_hand", "name": "長鞭", "kind": "leather", "weapon": "whip", "price": 120, "stats": {"hit": 1}, "scale": W, "desc": "編得很緊的長鞭，抽得到盾後面的人。"},
    'tower_shield': {"slot": "off_hand", "name": "塔盾", "kind": "metal", "price": 320, "stats": {"dr": 2, "evade": -1}, "threat": 0.2, "scale": {"dr": "half"}, "desc": "比人還高的大盾，舉起來就是一道牆。"},
    'parrying_dagger': {"slot": "off_hand", "name": "格擋短劍", "kind": "metal", "price": 140, "stats": {"evade": 1}, "scale": {"evade": "half", "crit": "third"}, "desc": "左手握的短劍，護手很寬，用來架開對方的刀。"},
    'grimoire': {"slot": "off_hand", "name": "魔導書", "kind": "cloth", "price": 180, "stats": {"save": 1}, "scale": {"save": "half", "hit": "third"}, "desc": "布面的魔導書，書頁裡夾滿了施法者的筆記。"},
    'scale_mail': {"slot": "body", "name": "鱗甲", "kind": "metal", "armor": "scale", "price": 4800, "scale": {"dr": "half"}, "desc": "一片片金屬鱗片縫在皮襯上，比鍊甲硬、比板甲輕。"},
    # 地下城專屬（exclusive）
    'rift_blade': {"slot": "main_hand", "name": "錯時刃", "kind": "metal", "weapon": "rift_blade", "price": 600, "stats": {"crit": 1}, "scale": W, "exclusive": True,
                   "desc": "歷史裂縫裡撿到的短刃，刀身比揮刀的手慢半拍——砍中的時候，對方已經以為躲過了。"},
    'banner_spear': {"slot": "main_hand", "name": "戰旗長槍", "kind": "wood", "weapon": "banner_spear", "two_handed": True, "price": 500, "stats": {"save": 1}, "scale": W, "exclusive": True,
                     "desc": "旗手那面斷旗的旗桿，裝上了槍尖。舉起來的時候，身後的人就不會退。"},
    'echo_mail': {"slot": "body", "name": "回響鱗鎧", "kind": "metal", "armor": "echo_mail", "price": 7000, "scale": {"dr": "half"}, "exclusive": True,
                  "desc": "守城將軍穿了兩百年的鎧甲，每一片甲葉上都留著一道不同時代的刀痕。"},
    'glance_bow': {"slot": "main_hand", "name": "殘光長弓", "kind": "wood", "weapon": "glance_bow", "two_handed": True, "price": 800, "scale": W, "exclusive": True,
                   "desc": "用「那一眼」照過的木頭做的長弓，射出去的箭帶著一道冷光。"},
    'chronicle_tome': {"slot": "off_hand", "name": "編年之書", "kind": "cloth", "price": 600, "stats": {"save": 1, "hit": 1}, "scale": {"save": "half", "hit": "half"}, "exclusive": True,
                       "desc": "無名史官的書，字還在一個一個地寫上去——寫的是拿著它的人接下來要做的事。"},
    'chronicle_guard': {"slot": "off_hand", "name": "編年鱗盾", "kind": "metal", "price": 500, "stats": {"dr": 1, "evade": 1}, "threat": 0.1, "scale": {"dr": "half", "evade": "third"}, "exclusive": True,
                        "desc": "幾片「編年的鱗片」拼成的圓盾，擋下來的每一擊都會在盾面上多刻一道。"},
    'vine_whip': {"slot": "main_hand", "name": "禁果藤鞭", "kind": "wood", "weapon": "vine_whip", "price": 400, "stats": {"hit": 1, "crit": 1}, "scale": W, "exclusive": True, "adult": True,
                  "desc": "園丁「蜜之手」的藤鞭，抽過的地方會開出粉紅色的小花，又癢又燙。"},
    'fruit_corset': {"slot": "body", "name": "禁果束衣", "kind": "leather", "armor": "fruit_corset", "price": 1200, "stats": {"save": 1}, "scale": {"evade": "half", "dr": "third"}, "exclusive": True, "adult": True,
                     "desc": "禁果之樹的樹皮鞣成的束衣，緊得勒出腰身，還帶著一點果香。"},
    'glimmer_veil': {"slot": "body", "name": "鱗光薄紗", "kind": "cloth", "armor": "glimmer_veil", "price": 1500, "scale": {"save": "up", "evade": "third"}, "exclusive": True, "adult": True,
                     "desc": "秘宮寢殿裡飄落的薄紗，鱗光一閃一閃，穿上的人像是站在狂歡的燈影裡。"},
    'first_cry': {"slot": "piercing", "name": "初啼耳墜", "kind": "jewel", "price": 300, "stats": {"save": 1}, "resist_scale": {"lust": "res"}, "exclusive": True, "adult": True,
                  "desc": "最初的魅魔吐出的第一聲嘆息凝成的耳墜，貼著耳垂微微發燙。"},
}
EXCLUSIVE = [k for k, v in BASES.items() if v.get('exclusive')]

# 地下城專屬底材做好的裝備：(底材, 材料, 附魔, 掉落的層主, 機率)
THEMED = {
    'rift_blade': ('riftsteel', {"mods": {"hit": 2, "crit": 2}}, 'hr_boss_last_castellan'),
    'banner_spear': ('ringwood', {"mods": {"damage": 2, "save": 2}}, 'hr_boss_standard_bearer'),
    'echo_mail': ('riftsteel', {"mods": {"dr": 1, "save": 2}, "resist": {"necrotic": -0.25}}, 'hr_boss_unending_battle'),
    'glance_bow': ('stilltime_wood', {"mods": {"hit": 2, "damage": 2}}, 'hc_boss_first_glance'),
    'chronicle_tome': ('afterglow_weave', {"mods": {"save": 2, "ap_regen": 1}}, 'hc_boss_nameless_chronicler'),
    'chronicle_guard': ('chronicle_steel', {"mods": {"dr": 1, "evade": 1, "save": 2}}, 'hc_boss_demon_king_shadow'),
    'vine_whip': ('fruitwood', {"mods": {"hit": 2, "crit": 2}, "offense": {"lust": 0.25}}, 'fg_boss_gardener'),
    'fruit_corset': ('white_serpent_hide', {"mods": {"evade": 2, "save": 2}}, 'fg_boss_forbidden_tree'),
    'glimmer_veil': ('wingweave', {"mods": {"evade": 2, "save": 2}}, 'pp_boss_succubus_mother'),
    'first_cry': ('charm_eye', {"mods": {"save": 2}, "offense": {"lust": 0.5}}, 'pp_boss_revel_master'),
}
THEMED_CHANCE = 0.2

# 傳說的獨特裝備：名稱 → (底材, 材料, 附魔, 獨特的檢定, 屬性, 掉落的層主, 成人向, 描述)
UNIQUES = {
    '旗手的盔': ('helm', 'riftsteel', {"mods": {"dr": 1, "save": 3}, "resist": {"necrotic": -0.5}}, {"contexts": ["save"]}, {"fai": 1}, 'hr_boss_standard_bearer', False,
              '被困在那一天的旗手戴了兩百年的頭盔。戴上之後，耳邊一直有人在喊：「不要退。」'),
    '最後一班崗的戰靴': ('sabatons', 'riftsteel', {"mods": {"dr": 2, "evade": 2}, "resist": {"fire": -0.5}}, {"contexts": ["initiative"]}, {"str": 1}, 'hr_boss_unending_battle', False,
                 '陷落那天站在城牆上的最後一雙靴子，鞋底還沾著燒焦的石灰。'),
    '遠古魔王的黑盾': ('shield', 'chronicle_steel', {"mods": {"dr": 2, "save": 2, "evade": 1}, "resist": {"necrotic": -0.25}}, {"attrs": ["cha"]}, {"str": 1}, 'hc_boss_demon_king_shadow', False,
                '遠古魔族之王的影子手上的盾，黑得照不出光；擋在前面的人，說話的時候別人會不自覺地低頭。'),
    '凝固的步伐': ('greaves', 'chronicle_steel', {"mods": {"dr": 2, "evade": 2, "crit": 2}}, {"contexts": ["initiative"]}, {"dex": 1}, 'hc_boss_nameless_chronicler', False,
              '迴廊裡凝固的行人腳上的腿甲，穿上之後，每一步都比別人早一點點落地。'),
    '殘光束帶': ('sash', 'afterglow_weave', {"mods": {"save": 2, "hit": 2, "ap_regen": 1}}, {"attrs": ["int"]}, {"int": 1}, 'hc_boss_first_glance', False,
             '「第一眼的殘光」散去之後留下的一條光帶，繫在腰上，想事情的時候會變亮。'),
    '蜜之手的護腕': ('bracers', 'white_serpent_hide', {"mods": {"hit": 2, "crit": 2, "evade": 2}}, {"kinds": ["flatter", "seduce"]}, {"dex": 1}, 'fg_boss_toybox', True,
               '園丁「蜜之手」澆了三百年水的那雙手戴的護腕，果汁的香味怎麼洗也洗不掉。'),
    '魅魔之母的腳鍊': ('anklet_bell', 'charm_eye', {"mods": {"save": 2, "evade": 2}, "offense": {"lust": 0.5}}, {"kinds": ["seduce", "flatter"]}, {"cha": 1}, 'pp_boss_succubus_mother', True,
                '魅魔之母腳踝上的鈴，每響一聲，附近的魅魔都會回頭。'),
    '千面的鏡珠': ('focus', 'charm_eye', {"mods": {"hit": 2, "save": 2}, "offense": {"psychic": 0.5}}, {"contexts": ["negotiation"]}, {"cha": 1}, 'pp_boss_thousand_faces', True,
              '千面的夢魔散去之後留下的寶珠，看著它的人，看見的是對方最想要的那一張臉。'),
}
UNIQUE_CHANCE = 0.2

# 層主掉的打造材料（機率都是 0.8，一次一份）：Lv.13～16 的兩座掉第 6 級（另外有第 5 級），Lv.17～20 的兩座只掉第 7 級。
# 歷史的兩座掉歷史系列、緋夢樂園底下的兩座掉歡愉系列（forge_item 依層主的前綴挑系列）；每一座都涵蓋那一級的五種類型
T5 = {'metal': '星隕鐵塊', 'leather': '古龍皮', 'cloth': '星輝絲', 'wood': '神木心材', 'jewel': '星辰石原石'}
FORGE_DROPS = {
    # 歷史裂縫（第 6 級）
    'hr_boss_standard_bearer': [('leather', 6), ('wood', 6), ('metal', 5)],
    'hr_boss_last_castellan': [('metal', 6), ('cloth', 6), ('leather', 5)],
    'hr_boss_unending_battle': [('jewel', 6), ('metal', 6), ('wood', 5), ('jewel', 5)],
    # 禁果庭園（歡愉系列第 6 級，成人向）
    'fg_boss_gardener': [('wood', 6), ('cloth', 6), ('cloth', 5)],
    'fg_boss_toybox': [('metal', 6), ('jewel', 6), ('jewel', 5)],
    'fg_boss_forbidden_tree': [('leather', 6), ('cloth', 6), ('wood', 6), ('leather', 5)],
    # 歷史迴廊（第 7 級）
    'hc_boss_nameless_chronicler': [('cloth', 7), ('wood', 7)],
    'hc_boss_demon_king_shadow': [('metal', 7), ('leather', 7)],
    'hc_boss_first_glance': [('jewel', 7), ('metal', 7), ('cloth', 7)],
    # 歡愉秘宮（歡愉系列第 7 級，成人向）
    'pp_boss_revel_master': [('jewel', 7), ('cloth', 7)],
    'pp_boss_thousand_faces': [('metal', 7), ('wood', 7)],
    'pp_boss_succubus_mother': [('leather', 7), ('cloth', 7), ('metal', 7)],
}
DROP_CHANCE = 0.8


SERIES_OF_BOSS = {'hr': 'history', 'hc': 'history', 'fg': 'pleasure', 'pp': 'pleasure'}


def forge_item(boss, kind, tier):
    if tier == 5:
        return T5[kind]
    return FORGE_ITEMS[MAT_BY[(SERIES_OF_BOSS[boss.split('_')[0]], kind, tier)]][0]


def DROPS():
    """層主 → 掉落 [(物品, 機率, 數量)]：high_dungeons31.py 接在層主原本的掉落後面"""
    out = {}
    for boss, rows in FORGE_DROPS.items():
        out.setdefault(boss, []).extend((forge_item(boss, k, t), DROP_CHANCE, 1) for k, t in rows)
    for base, (mat, _, boss) in THEMED.items():
        out.setdefault(boss, []).append((themed_name(base), THEMED_CHANCE, 1))
    for name, u in UNIQUES.items():
        out.setdefault(u[5], []).append((name, UNIQUE_CHANCE, 1))
    return out


def themed_name(base):
    return BASES[base]['name']


# ---------------- 價格、名稱（照 src/engine/gear.ts 的 gearName、gearPrice、enchantPoints） ----------------
GEAR = None
COSTS = {"hit": 1, "damage": 1, "evade": 1, "dr": 1, "save": 1, "crit": 1, "ap_regen": 2}


def all_bases():
    return {**GEAR['bases'], **BASES}


def all_mats():
    out = dict(GEAR['materials'])
    for k, v in MATERIALS.items():
        out[k] = material_def(k)
    return out


def points(e):
    n = 0
    for k, v in (e or {}).get('mods', {}).items():
        n += abs(v) * COSTS.get(k, 1)
    for v in (e or {}).get('resist', {}).values():
        n += abs(v) / 0.25
    for v in (e or {}).get('offense', {}).values():
        n += abs(v) / 0.25
    return n


def price(base, mat, enchants=None):
    return round(all_bases()[base]['price'] * all_mats()[mat]['price'] * (1 + 0.5 * points(enchants)))


def gear_name(base, mat):
    m = all_mats()[mat]
    b = all_bases()[base]['name']
    if m['kind'] == 'leather' and b.startswith('皮'):
        return b if m['tier'] == 1 else m['name'] + (b[1:] if m['name'].endswith('皮') else b)
    return m['name'] + b


def material_def(k):
    series, kind, name, tier, bonus, level, pr, armor, resist, desc = MATERIALS[k]
    d = {"kind": kind, "name": name, "tier": tier, "bonus": bonus, "rarity": "legendary", "level": level, "price": pr, "series": series}
    if armor:
        d["armor"] = armor
    if resist:
        d["resist"] = resist
    d["desc"] = desc
    return d


def line(obj, spaced=True):
    s = json.dumps(obj, ensure_ascii=False)
    # 制式裝備的 gear 照原本的排版：{ "base": ..., "material": ... }
    s = re.sub(r'"gear": \{("base": "[a-z_]+", "material": "[a-z_]+")\}', r'"gear": { \1 }', s)
    return '{ ' + s[1:-1] + ' }' if spaced else s


LOC_BY_TIER = {3: 'city', 4: 'capital'}
SHOP = {'metal': 'smith', 'wood': 'smith', 'leather': 'tailor', 'cloth': 'tailor', 'jewel': 'jeweler'}


def catalog_item(base, mat):
    b = all_bases()[base]
    m = all_mats()[mat]
    it = {"name": gear_name(base, mat), "category": "equipment", "price_cc": price(base, mat), "tags": [SHOP[m['kind']]] if m['tier'] <= 4 else [],
          "gear": {"base": base, "material": mat}}
    if m['tier'] in LOC_BY_TIER:
        it["min_location"] = LOC_BY_TIER[m['tier']]
    desc = (b.get('desc') or '') + (m.get('desc') or '')
    if desc:
        it["desc"] = desc
    if MATERIALS.get(mat, ('',))[0] == 'pleasure':
        it["adult"] = True
    return it


# ---------------- 寫檔 ----------------
def untrail(t):
    """拿掉上一次寫進去的行之後，留在物件或陣列結尾的逗號"""
    return re.sub(r',(\s*\n\s*[\]}])', r'\1', t)


def write_gear():
    p = 'data/rules/gear.json'
    t = open(p).read()
    # 材料：接在同類型第 5 級那一行後面
    for k in MATERIALS:
        t = re.sub(r'\n    "' + k + r'": \{.*', '', t)
    t = untrail(t)
    for kind, t5 in [('metal', 'star_iron'), ('leather', 'elder_dragonhide'), ('cloth', 'starweave'), ('wood', 'divine_wood'), ('jewel', 'starstone')]:
        m = re.search(r'\n    "' + t5 + r'": +\{.*', t)
        ln = m.group(0)
        rows = [f'    "{k}": {line(material_def(k))}' for k, v in MATERIALS.items() if v[1] == kind]
        last = ln.endswith(',')
        t = t[:m.start()] + ln.rstrip(',') + ',\n' + ',\n'.join(rows) + (',' if last else '') + t[m.end():]
    # 底材：接在 bases 的最後
    for k in BASES:
        t = re.sub(r'\n    "' + k + r'": \{ "slot".*', '', t)
    t = untrail(t)
    i = t.index('"bases": {')
    j = t.index('\n  },', i)
    head = t[:j].rstrip().rstrip(',')
    t = head + ',\n' + ',\n'.join(f'    "{k}": {line(v)}' for k, v in BASES.items()) + t[j:]
    # 打造的工錢與 DC
    t = re.sub(r'"fee": \[[\d, ]+\]', '"fee": ' + json.dumps(CRAFT_FEE), t, count=1)
    t = re.sub(r'"dc": \[[\d, ]+\]', '"dc": ' + json.dumps(CRAFT_DC), t, count=1)
    json.loads(t)
    open(p, 'w').write(t)


def write_crafts():
    p = 'data/rules/crafts.json'
    t = open(p).read()
    t = re.sub(r'"max_level": \d+', f'"max_level": {SKILL_MAX}', t, count=1)
    t = re.sub(r'"xp_to_next": \[[\d, ]+\]', '"xp_to_next": ' + json.dumps(XP_TO_NEXT), t, count=1)
    t = re.sub(r'"tool_tier": \[[\d, ]+\]', '"tool_tier": ' + json.dumps(TOOL_TIER), t, count=1)
    t = re.sub(r'"capital": \[\d+, \d+\]', '"capital": ' + json.dumps(CAPITAL_LEVELS), t, count=1)
    json.loads(t)
    open(p, 'w').write(t)


def write_equipment():
    p = 'data/rules/equipment.json'
    t = open(p).read()
    for k in list(WEAPONS) + list(ARMORS):
        t = re.sub(r'\n    "' + k + r'": \{ "name".*', '', t)
    t = untrail(t)
    for key, table, anchor in [('weapons', WEAPONS, '"monk_fists"'), ('armors', ARMORS, '"plate"')]:
        m = re.search(r'\n    ' + anchor + r': \{.*', t)
        ln = m.group(0)
        rows = [f'    "{k}": {line(v)}' for k, v in table.items()]
        t = t[:m.start()] + ln.rstrip(',') + ',\n' + ',\n'.join(rows) + (',' if ln.endswith(',') else '') + t[m.end():]
    json.loads(t)
    open(p, 'w').write(t)


def write_items():
    p = 'data/rules/items.json'
    t = open(p).read()
    names = [v[0] for v in FORGE_ITEMS.values()] + [themed_name(b) for b in THEMED] + list(UNIQUES)
    # 制式裝備：新材料 × 所有同類型的一般底材、新的一般底材 × 所有材料
    new_mats = set(MATERIALS)
    plain_new = [k for k, v in BASES.items() if not v.get('exclusive')]
    for n in names:
        t = re.sub(r'\n    \{ ?"name": ' + re.escape(json.dumps(n, ensure_ascii=False)) + r',.*', '', t)
    t = re.sub(r'\n    \{ "name": "[^"]+", "category": "equipment", "price_cc": \d+, "tags": \[[^\]]*\], "gear": \{ ?"base": "(?:' + '|'.join(plain_new) + r')", "material": "[a-z_]+" ?\}.*', '', t)
    t = re.sub(r'\n    \{ "name": "[^"]+", "category": "equipment", "price_cc": \d+, "tags": \[[^\]]*\], "gear": \{ ?"base": "[a-z_]+", "material": "(?:' + '|'.join(new_mats) + r')" ?\}.*', '', t)
    t = re.sub(r',(\s*\n\s*\])', r'\1', t)
    data = json.loads(t)
    have = {i['name'] for i in data['items']}
    # 現有底材的第 6、7 級：接在第 5 級那一行後面
    bases = GEAR['bases']
    for bid, b in bases.items():
        if b.get('restraint') or b.get('outfit'):
            continue
        t5 = {'metal': 'star_iron', 'leather': 'elder_dragonhide', 'cloth': 'starweave', 'wood': 'divine_wood', 'jewel': 'starstone'}[b['kind']]
        m = re.search(r'\n    \{ "name": "[^"]+", "category": "equipment", "price_cc": \d+, "tags": \[\], "gear": \{ "base": "' + bid + r'", "material": "' + t5 + r'" \}.*', t)
        if not m:
            continue
        ln = m.group(0)
        mats = [k for k, v in MATERIALS.items() if v[1] == b['kind']]
        rows = ['    ' + line(catalog_item(bid, k)) for k in mats if gear_name(bid, k) not in have]
        if rows:
            t = t[:m.start()] + ln.rstrip(',') + ',\n' + ',\n'.join(rows) + (',' if ln.endswith(',') else '') + t[m.end():]
    # 新的一般底材：所有等級的材料，接在制式裝備的最後（最後一件星隕鐵的制式品後面）
    mats = all_mats()
    last = None
    for m in re.finditer(r'\n    \{ "name": "[^"]+", "category": "equipment", "price_cc": \d+, "tags": \[[^\]]*\], "gear": \{ "base": "[a-z_]+", "material": "[a-z_]+" \}.*', t):
        last = m
    rows = []
    for bid in plain_new:
        kind = BASES[bid]['kind']
        for mid, mm in sorted(((k, v) for k, v in mats.items() if v['kind'] == kind), key=lambda x: x[1]['tier']):
            rows.append('    ' + line(catalog_item(bid, mid)))
    ln = last.group(0)
    t = t[:last.start()] + ln.rstrip(',') + ',\n' + ',\n'.join(rows) + (',' if ln.endswith(',') else '') + t[last.end():]
    # 打造材料：接在星辰石原石後面；專屬底材的裝備、獨特裝備接在打造材料後面
    m = re.search(r'\n    \{ "name": "星辰石原石".*', t)
    ln = m.group(0)
    extra = []
    for k, (n, pr, desc) in FORGE_ITEMS.items():
        it = {"name": n, "category": "material", "price_cc": pr, "tags": []}
        if MATERIALS[k][0] == 'pleasure':
            it["adult"] = True
        it.update({"desc": desc, "forge": {"materials": [k]}})
        extra.append('    ' + line(it))
    for bid, (mat, ench, boss) in THEMED.items():
        spec = {"base": bid, "material": mat, "enchants": ench}
        it = {"name": themed_name(bid), "category": "equipment", "price_cc": price(bid, mat, ench), "tags": []}
        if BASES[bid].get('adult'):
            it["adult"] = True
        it["desc"] = BASES[bid]['desc'] + all_mats()[mat]['desc']
        it["gear"] = spec
        extra.append('    ' + json.dumps(it, ensure_ascii=False))
    for name, (bid, mat, ench, check, attrs, boss, adult, desc) in UNIQUES.items():
        spec = {"base": bid, "material": mat, "rarity": "legendary", "enchants": ench, "unique": {"check": check, "bonus": 3}, "attrs": attrs}
        it = {"name": name, "category": "equipment", "price_cc": price(bid, mat, ench), "tags": ["unique"]}
        if adult:
            it["adult"] = True
        it["desc"] = desc
        it["gear"] = spec
        extra.append('    ' + json.dumps(it, ensure_ascii=False))
    t = t[:m.start()] + ln.rstrip(',') + ',\n' + ',\n'.join(extra) + (',' if ln.endswith(',') else '') + t[m.end():]
    json.loads(t)
    open(p, 'w').write(t)


def write():
    global GEAR
    GEAR = json.load(open('data/rules/gear.json'))
    for k in list(MATERIALS) + list(BASES):
        GEAR['materials'].pop(k, None)
        GEAR['bases'].pop(k, None)
    write_gear()
    write_crafts()
    write_equipment()
    write_items()
    print('materials', len(MATERIALS), 'bases', len(BASES), 'uniques', len(UNIQUES), 'themed', len(THEMED))


GEAR = json.load(open('data/rules/gear.json'))
if __name__ == '__main__':
    write()
