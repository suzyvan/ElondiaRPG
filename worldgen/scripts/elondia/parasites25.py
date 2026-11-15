"""第二批（M2）：寄生物。寫進
- data/rules/parasites.json：規則與三種寄生物（渴求的魔導衣、魅魔的契紋、寄生植物的種子）
- data/rules/items.json：寄生裝備與馴服後的獨特色情裝備（接在任務的獨特裝備後面）
- data/rules/travel_events.json：發作事件（scope: parasite），接在地下城事件後面
任務線在 story_batch25.py。可以重跑。
"""
import json, re

R = ''
LINGERIE, MARK, SEED = 'hungry_lingerie', 'succubus_mark', 'parasite_seed'

RULES = {
    "$comment": "寄生物（見 docs/ADULT_EVENTS.md 第 6 節）：侵蝕度 0～100 依 stages 分階段（min 是門檻，chance_mult 是這個階段發作的機率倍率）。發作：走動每一步 step_chance、旅途每天 travel_chance、長休之後 rest_chance（都再乘上存檔規則「寄生發作的機率」），兩次至少隔 cooldown_hours 小時；同一件發作至少隔 repeat_hours 小時才會再出現（這段時間沒有別件可以發作時就不發作）。dc 是發作檢定的普通難度：base + 主角等級 × per_level（四捨五入）+ 階段的加減；選項寫的 DC 以 14 為「普通」，實際 DC = 普通難度 +（寫的 DC − 14）+ 存檔規則「事件檢定的難度」。remove 是解咒的地方（神殿、刻印師）與擲骰的屬性。parasites：kind gear（寄生裝備：item 物品鎖在 slot 欄位）、mark（淫紋：刻在 place 的詛咒印記）、seed（寄生種子）；grow_per_day 每天自己增長的侵蝕度；stage_effects 各階段的被動效果（檢定加減）；remove 解咒的 DC 與價錢基準（DC + 侵蝕度/10、價錢 ×(1 + 侵蝕度/100)）；reink_price 刻印師紋回來的價錢；stories 解咒時中止的任務線（連同 flag_prefix 開頭的劇情旗標一起清掉，之後再被寄生可以重來）；tamed 馴服之後的物品或印記、主動觸發的親密場景（scene）、結果（text）與狀態（buff）。",
    "step_chance": 0.01, "travel_chance": 0.3, "rest_chance": 0.25, "cooldown_hours": 8, "repeat_hours": 72,
    "dc": {"base": 12, "per_level": 0.4, "stages": [0, 0, 1, 2]},
    "stages": [
        {"min": 0, "name": "潛伏", "chance_mult": 0.5},
        {"min": 30, "name": "發作", "chance_mult": 1},
        {"min": 60, "name": "共生", "chance_mult": 1},
        {"min": 90, "name": "支配", "chance_mult": 2},
    ],
    "remove": {"temple": {"name": "神殿的解咒", "attr": "fai"}, "carver": {"name": "刻印師的解咒", "attr": "int"}},
    "parasites": {
        LINGERIE: {
            "name": "渴求的魔導衣", "kind": "gear", "item": "渴求的魔導衣", "slot": "underwear_top",
            "desc": "從擬態寶箱裡爬出來、貼在身上脫不下來的黑色蕾絲內衣。它是活的，會餓，餓的時候會自己動。",
            "grow_per_day": 2,
            "stage_effects": [
                [],
                [{"check": {"attrs": ["dex"]}, "bonus": -1}],
                [{"check": {"attrs": ["dex"]}, "bonus": -1}, {"check": {"kinds": ["flatter", "chat"]}, "bonus": 1}],
                [{"check": {"attrs": ["dex"]}, "bonus": -2}, {"check": {"kinds": ["flatter", "chat"]}, "bonus": 1}],
            ],
            "remove": {"dc": 14, "price": 1500}, "reink_price": 0,
            "stories": ["par_lin_look", "par_lin_feed", "par_lin_relic", "par_lin_master"], "flag_prefix": "par_lin_",
            "tamed": {
                "item": "馴服的魔導衣",
                "scene": "主角主動喚醒已經馴服的魔導衣：黑色的蕾絲照著主角的心意在身上游走、收緊、撫弄，主角想要多少就給多少，想停就停。這一次是主角在使用它。",
                "text": "你喚醒了魔導衣。它乖乖地照著你的意思動，直到你滿足為止。",
                "buff": "parasite_glow",
            },
        },
        MARK: {
            "name": "魅魔的契紋", "kind": "mark", "place": "belly",
            "mark": {"name": "魅魔的契紋", "desc": "小腹上一個桃紅色的紋樣，形狀像一顆被藤蔓纏住的心。發作的時候會發燙、發亮。"},
            "desc": "魅魔在小腹刻下的淫紋。發作時身體會不聽使喚；它是一份契約的一半，另一半在刻紋的魅魔手上。",
            "grow_per_day": 2,
            "stage_effects": [
                [],
                [{"check": {"attrs": ["fai"]}, "bonus": -1}],
                [{"check": {"attrs": ["fai"]}, "bonus": -1}, {"check": {"attrs": ["cha"]}, "bonus": 1}],
                [{"check": {"attrs": ["fai"]}, "bonus": -2}, {"check": {"attrs": ["cha"]}, "bonus": 1}],
            ],
            "remove": {"dc": 15, "price": 1800}, "reink_price": 600,
            "stories": [f"{q}{v}" for v in ("", "_cas") for q in ("par_mark_help", "par_mark_find", "par_mark_contracts", "par_mark_rewrite")], "flag_prefix": "par_mark_",
            "tamed": {
                "mark": {"name": "主宰之紋", "desc": "小腹上的紋樣變成了深紅色，藤蔓反過來把心護在中間。它現在聽你的。",
                         "attrs": {"cha": 2, "fai": 1}, "check": {"attrs": ["cha"]}, "bonus": 3},
                "scene": "主角主動點亮主宰之紋：紋樣的熱流照著主角的意思在身體裡奔湧，主角任由慾望漲滿、再一口氣釋放，完全由自己掌控節奏。",
                "text": "你點亮了主宰之紋。熱流在身體裡奔湧，最後化成一股滿足的倦意。",
                "buff": "parasite_glow",
            },
        },
        SEED: {
            "name": "寄生植物的種子", "kind": "seed",
            "desc": "寄生植物推進身體深處的一顆種子。溫溫的，偶爾會動一下；幾天之後就會發芽。",
            "grow_per_day": 30,
            "stage_effects": [[], [{"check": {"attrs": ["dex"]}, "bonus": -1}], [{"check": {"attrs": ["dex"]}, "bonus": -1}], [{"check": {"attrs": ["dex"]}, "bonus": -2}]],
            "remove": {"dc": 12, "price": 400},
        },
    },
}

# ---------------- 物品 ----------------
ITEMS = [
    {"name": "渴求的魔導衣", "category": "equipment", "price_cc": 1500, "tags": ["unique"], "adult": True,
     "desc": "黑色蕾絲的胸衣，蕾絲底下織著細細的魔導迴路。它是活的、會餓——穿上之後就脫不下來，只有解咒或馴服才能讓它鬆手。",
     "gear": {"base": "lace_bra", "material": "moonsilk", "rarity": "rare", "attrs": {"cha": 1}}},
    {"name": "馴服的魔導衣", "category": "equipment", "price_cc": 9000, "tags": ["unique"], "adult": True,
     "desc": "認了主人的魔導衣。蕾絲照著主人的心意收緊、放鬆，替主人擋下惡意的咒語，也讓主人的一舉一動都帶著讓人移不開眼的魅力。",
     "gear": {"base": "lace_bra", "material": "spellweave", "rarity": "epic", "attrs": {"cha": 2, "dex": 1},
              "enchants": {"mods": {"save": 1, "evade": 1}},
              "unique": {"check": {"kinds": ["chat", "flatter", "negotiation", "bargain"]}, "bonus": 3}}},
]

# 主動喚醒馴服的寄生物之後的狀態（companions.json 的 conditions）
CONDS = {
    "parasite_glow": {"name": "饜足的光彩", "desc": "喚醒了馴服的寄生物，全身都帶著饜足的光彩。下次長休前魅力檢定 +2。", "check_penalty": -2, "check_attrs": ["cha"], "clears": "long_rest"},
}


# ---------------- 發作事件（travel_events.json，scope: parasite） ----------------
def cond(c):
    return {"type": "condition", "target": "pc", "condition": c, "add": True}


def cor(pid, n):
    return {"type": "corruption", "parasite": pid, "delta": n}


def hp(r):
    return {"type": "hp", "target": "pc", "ratio": r}


def money(n):
    return {"type": "money", "amount": n}


def out(text, *effects):
    o = {"text": text}
    if effects: o["effects"] = list(effects)
    return o


def opt(label, success, fail=None, check=None, scene=None):
    o = {"label": label}
    if check: o["check"] = {"attr": check[0], "dc": check[1]}
    o["success"] = success
    if fail: o["fail"] = fail
    if scene: o["adult_scene"] = scene
    return o


# 文字寫到胸口的魔導衣發作事件：只給陰柔、中性體型（陽剛主角的魔導套只會遇到其他 4 件；2026-11-14）
CHEST = {'lin_tighten', 'lin_night', 'lin_public', 'lin_hungry', 'lin_more', 'lin_tendril', 'lin_symbiosis'}


def pe(pid, i, title, stages, moments, text, scene, options, unwilling=True):
    t = {"id": f"pe_{i}", "scope": "parasite", "tier": "normal", "kind": "choice", "parasite": pid}
    if stages: t["stages"] = stages
    if moments and len(moments) < 3: t["moments"] = moments
    t["tags"] = ["adult", "pc_unwilling"] if unwilling else ["adult"]
    if i in CHEST: t["pc_body"] = ["fem", "andro"]
    t.update({"title": title, "text": text, "scene": scene, "options": options})
    return t


L, M, S = LINGERIE, MARK, SEED
E = [
    # ---------------- 渴求的魔導衣 ----------------
    pe(L, 'lin_tighten', '蕾絲收緊', [0, 1], ['step'],
       '走著走著，胸口的蕾絲突然收緊了一圈，細細的紋路貼著皮膚慢慢地爬，像在確認你還在不在。',
       '魔導衣在主角走路時收緊、摩擦，蕾絲的紋路在胸前一圈一圈地游走，主角只能夾緊雙腿繼續往前走。',
       [opt('深呼吸，不理它', out('你數著步子，把注意力放在路上。它扭了幾下，覺得無趣，又安靜了下來。', cor(L, -4)),
            out('越不理它，它勒得越緊。你走得越來越慢。', cor(L, 4), cond('sensitive')), ('fai', 12), 'fail'),
        opt('伸手進衣服裡調整', out('你找到它最敏感的那條迴路，按住。它抖了一下，乖乖地鬆開了。', cor(L, -3)),
            out('手一伸進去，它就纏上了你的手指，順勢把你的手按在了胸口上。', cor(L, 5), cond('aroused')), ('dex', 12), 'fail'),
        opt('讓它玩一下', out('你停下腳步，靠著牆，讓它照自己的意思動了一會兒。它滿足地鬆開時，你的腿還在發軟。', cor(L, 6), cond('afterglow')), scene='always')]),
    pe(L, 'lin_night', '夜裡的蕾絲', [0, 1, 2], ['rest'],
       '你睡到一半醒過來——胸口濕濕熱熱的。魔導衣趁著你睡著，把蕾絲伸展開來，覆住了你半個身體。',
       '魔導衣在主角睡夢中伸展開來，蕾絲像無數細小的手指撫過胸口、腰側與大腿內側，主角在半夢半醒間被它玩弄到天亮。',
       [opt('把它撥回原處', out('你一條一條地把蕾絲撥回去。它不甘心地縮回胸口，你一直醒到天亮才敢再睡。', cor(L, -4)),
            out('撥回去一條，又長出來兩條。', cor(L, 5), cond('afterglow')), ('dex', 13), 'fail'),
        opt('念一段安眠咒給它聽', out('魔導迴路跟著咒文的節奏慢了下來，最後像貓一樣蜷著不動了。', cor(L, -5)),
            out('咒文念錯了一個音，它反而更興奮了。', cor(L, 5), cond('afterglow')), ('int', 13), 'fail'),
        opt('閉上眼睛，任它去', out('你翻了個身，任由它在你身上遊走。早上醒來時，你睡得出奇地好。', cor(L, 6), hp(0.1)), scene='always')]),
    pe(L, 'lin_public', '人前發作', [1, 2], ['step'],
       '人群裡，魔導衣毫無預警地動了起來——蕾絲收緊、放鬆、再收緊，正好在最尖的地方。旁邊的人奇怪地看了你一眼。',
       '魔導衣在人群中發作，主角咬著嘴唇強裝鎮定，蕾絲卻越來越過分；主角只能找個角落，在別人看不到的地方顫抖著等它停下。',
       [opt('若無其事地繼續走', out('你笑著跟旁邊的人點了點頭，若無其事地走過人群。它發現沒有人注意，就安靜了。', cor(L, -5)),
            out('你的聲音抖了一下。那個人的目光停在你的胸口上，很久。', cor(L, 5), cond('disheveled')), ('cha', 13), 'fail'),
        opt('躲進巷子裡', out('你閃進一條沒人的巷子，按住胸口等它平靜下來。', cor(L, -2)),
            out('巷子裡沒有人——它好像就在等這個。', cor(L, 6), cond('afterglow')), ('dex', 12), 'fail'),
        opt('躲進角落，讓它做完', out('你靠在角落的牆上，捂著嘴，任它做完它想做的事。走出來的時候，你的臉紅得像發燒。', cor(L, 7), cond('afterglow')), scene='always')]),
    pe(L, 'lin_saddle', '顛簸的路', [1, 2], ['travel'],
       '路很顛。每一下顛簸，魔導衣就跟著收緊一下，好像把顛簸當成了遊戲。同伴問你臉怎麼這麼紅。',
       '旅途的顛簸讓魔導衣興奮起來，蕾絲隨著每一下晃動收緊、摩擦；主角在同伴身邊強忍著，最後還是在路邊的樹叢裡被它弄得腿軟。',
       [opt('說是太陽太大', out('「太陽太大了。」你笑著說，拉低了帽簷。它玩了一陣，玩膩了。', cor(L, -4)),
            out('同伴不信，一直盯著你看。你越緊張，它越起勁。', cor(L, 5), cond('aroused')), ('cha', 12), 'fail'),
        opt('下來走一段路', out('你跳下來自己走。腳踏實地，它就沒那麼起勁了。', cor(L, -3)),
            out('走路的時候，它換了一種玩法。', cor(L, 5), cond('sensitive')), ('str', 12), 'fail'),
        opt('藉口去樹叢裡方便', out('你在樹叢裡待了很久才回來。同伴沒有問——你也沒有說。', cor(L, 7), cond('afterglow')), scene='always')]),
    pe(L, 'lin_hungry', '它餓了', [1, 2, 3], ['step', 'travel'],
       '魔導衣餓了。它的「餓」是一種從胸口擴散開來的熱，一陣一陣地，直到你餵它為止——它要的「食物」，是你身體被撩撥起來時流出的東西。',
       '主角找了一個沒有人的地方餵魔導衣：讓它撫弄、刺激，直到主角的身體給出它要的東西；它飽足地吸收著，蕾絲泛著滿足的光澤。',
       [opt('硬撐過去', out('你咬緊牙關撐了一個下午。熱度慢慢退了，它餓著肚子睡著了。', cor(L, -6)),
            out('撐不住。你雙腿一軟，跪了下來。', cor(L, 6), cond('aroused'), cond('sensitive')), ('fai', 14), 'fail'),
        opt('用魔力餵它', out('你把一縷魔力送進迴路裡。它吃得不太滿意，但總算安靜了。', cor(L, -3)),
            out('魔力不合它的胃口——它要的是別的。', cor(L, 6), cond('aroused')), ('int', 14), 'fail'),
        opt('找個沒人的地方餵它', out('你找了個隱密的地方，讓它吃飽。它飽足之後，一股暖流反過來流進你的身體——傷口不疼了。', cor(L, 8), hp(0.2), cond('afterglow')), scene='always')]),
    pe(L, 'lin_more', '它要更多', [2, 3], ['rest'],
       '你夢見自己全身都穿著黑色的蕾絲。醒過來時，魔導衣真的長大了——它從胸口一路延伸到了腰間、到了大腿，像一層新的皮膚。',
       '魔導衣在夜裡長成了一整套蕾絲，緊貼著主角的全身，在每一個敏感的地方同時動作；主角在床上弓起身子，被自己的「衣服」侵犯到天亮。',
       [opt('逼它縮回去', out('你用意志一點一點地把它逼回胸口。它退回去了，你卻覺得少了什麼。', cor(L, -6)),
            out('它不肯退。它說——你覺得它在說——這是它的身體了。', cor(L, 6), cond('afterglow'), cond('drained')), ('fai', 15), 'fail'),
        opt('把延伸出去的蕾絲剪掉', out('剪刀剪下去，它尖叫似地縮了回去，剪下的蕾絲化成了灰。', cor(L, -5), hp(-0.1)),
            out('剪刀被它纏住了。', cor(L, 6), cond('afterglow')), ('dex', 15), 'fail'),
        opt('讓它把你全身包住', out('你任它把你包得緊緊的。那一夜很長，很熱；天亮時它退回胸口，你渾身是汗，卻精神飽滿。', cor(L, 9), hp(0.15), cond('afterglow')), scene='always')]),
    pe(L, 'lin_tendril', '伸出的觸鬚', [2, 3], ['step'],
       '魔導衣的邊緣長出了細細的、像觸鬚一樣的蕾絲，順著你的小腹往下爬。它不滿足於胸口了。',
       '魔導衣長出的蕾絲觸鬚往下探進主角的雙腿之間，一邊撫弄一邊往裡面鑽，主角在大白天裡被它從裡到外地玩弄。',
       [opt('抓住觸鬚，扯斷', out('你一把抓住觸鬚扯斷。它痛得縮成一團，好幾天都不敢再動。', cor(L, -7), hp(-0.05)),
            out('觸鬚比你想的更韌，你一扯，它反而纏住了你的手腕。', cor(L, 6), cond('sensitive'), cond('aroused')), ('str', 14), 'fail'),
        opt('用祈禱壓制它', out('你低聲祈禱，觸鬚在聖言裡枯萎了。', cor(L, -6)),
            out('祈禱斷斷續續的，因為你的聲音一直在抖。', cor(L, 6), cond('afterglow')), ('fai', 14), 'fail'),
        opt('張開腿，讓它進來', out('你讓它進來了。它在你身體裡待了很久，出來的時候，帶走了你所有的力氣，也留下了奇怪的、暖洋洋的滿足感。', cor(L, 9), cond('afterglow'), cond('drained')), scene='always')]),
    pe(L, 'lin_campfire', '營火邊的秘密', [2, 3], ['travel'],
       '營火邊，同伴們都睡了。魔導衣開始在你的衣服底下輕輕地動，像在說：只有我們兩個了。',
       '營火邊，主角在熟睡的同伴身旁被魔導衣撫弄，一邊怕被發現、一邊又忍不住迎合；火光照著主角咬著衣角的臉。',
       [opt('起來守夜，讓自己清醒', out('你起來添柴、守夜，冷風吹了一整夜。它在冷風裡縮成一團，乖乖地睡著了。', cor(L, -5)),
            out('你站著守夜，它就站著玩你。', cor(L, 5), cond('afterglow')), ('fai', 13), 'fail'),
        opt('悄悄走遠一點', out('你走到聽不見營地的地方，坐下來安撫它。它吃了點甜頭，就滿足了。', cor(L, -2)),
            out('走遠了，它就更放肆了。', cor(L, 6), cond('afterglow')), ('dex', 13), 'fail'),
        opt('就在營火邊', out('你在同伴的鼾聲裡，蓋著毯子，讓它做完。沒有人醒來——你希望沒有人醒來。', cor(L, 8), cond('afterglow')), scene='always')]),
    pe(L, 'lin_dominate', '它想穿著你', [3], ['step', 'travel'],
       '你的手自己動了起來，解開了外衣的扣子。不是你要解的——是魔導衣。它想讓所有人看見它，看見穿著它的你。',
       '被魔導衣支配的主角在外面解開衣服，讓黑色蕾絲暴露在眾人眼前，身體照著它的意思擺出撩人的姿勢，腦袋裡只剩下被注視的快感。',
       [opt('奪回自己的手', out('你用盡全身的意志把手按回去，一顆一顆地把扣子扣好。它不甘心地縮了一下——這一次你贏了。', cor(L, -8)),
            out('手不聽你的。最後一顆扣子也解開了。', cor(L, 6), cond('disheveled'), cond('afterglow')), ('fai', 16), 'fail'),
        opt('用魅力把場面圓過去', out('你乾脆大方地笑了笑，把外衣披回肩上，像是本來就打算這麼穿。看的人反而不好意思了。', cor(L, -4), money(30)),
            out('你想圓場，可是聲音一出口就變成了喘息。', cor(L, 6), cond('disheveled')), ('cha', 15), 'fail'),
        opt('讓所有人都看見', out('你讓它展示了個夠。人群散去時，有人往你腳邊丟了幾枚錢幣——你分不清那是讚美還是什麼。', cor(L, 10), money(60), cond('disheveled'), cond('afterglow')), scene='always')]),
    pe(L, 'lin_symbiosis', '共生的夢', [3], ['rest'],
       '夢裡，你和魔導衣是同一個東西。它的飢餓是你的飢餓，你的快感是它的食物。夢裡的聲音問你：要不要永遠這樣下去？',
       '主角在夢裡與魔導衣融為一體，蕾絲長進皮膚裡，每一條迴路都連著主角的神經；夢裡的快感無窮無盡，主角幾乎不想醒來。',
       [opt('「不要。」', out('你在夢裡說了「不要」，用力睜開眼睛。胸口的蕾絲安靜地貼著，像是被你嚇到了。', cor(L, -10)),
            out('你想說不要，可是夢裡的你已經點頭了。', cor(L, 6), cond('dazed'), cond('afterglow')), ('fai', 16), 'fail'),
        opt('在夢裡跟它談條件', out('「你可以吃，但要聽我的。」它好像聽懂了，夢的顏色變淡了一點。', cor(L, -6)),
            out('跟一件衣服談條件——夢裡的你笑了出來，然後就被它吞了下去。', cor(L, 6), cond('dazed')), ('int', 15), 'fail'),
        opt('「好。」', out('你說了「好」。那個夢很長、很甜。醒來時你身上的每一道傷都癒合了，胸口的蕾絲閃著滿足的光。', cor(L, 10), hp(0.3), cond('afterglow')), scene='always')]),
    pe(L, 'lin_flirt', '它在勾引人', [1, 2, 3], ['step'],
       '魔導衣讓你的身體散發出一種甜甜的熱度。一個陌生人走了過來，眼睛盯著你，像被什麼牽著。「妳……需要幫忙嗎？」',
       '被魔導衣的熱度吸引而來的陌生人與主角在暗處糾纏，魔導衣在兩人之間收緊、吸收，貪婪地吃著這頓大餐。',
       [opt('客氣地拒絕', out('你笑著說不用，轉身走開。陌生人愣在原地，像剛從夢裡醒來。', cor(L, -4)),
            out('你的「不用」說得一點說服力都沒有。他跟了上來。', cor(L, 5), cond('aroused')), ('cha', 13), 'fail'),
        opt('趕快離開', out('你快步離開人群，熱度在風裡散了。', cor(L, -3)),
            out('你走得越快，跟上來的人越多。', cor(L, 5), cond('aroused')), ('dex', 13), 'fail'),
        opt('「需要。」', out('你牽起他的手，走進了暗處。魔導衣吃得很飽，那個陌生人走的時候，連自己的名字都說不太清楚。', cor(L, 8), hp(0.1), cond('afterglow')), scene='always')]),

    # ---------------- 魅魔的契紋 ----------------
    pe(M, 'mark_heat', '小腹發燙', [0, 1], ['step'],
       '小腹上的紋樣突然燙了起來，桃紅色的光從衣服底下透出來。一股熱流往下沉，沉到了兩腿之間。',
       '契紋發燙，熱流在主角的下腹蔓延，身體自己濕了、軟了；主角扶著牆，隔著衣服按住發光的紋樣，卻只讓熱度更深。',
       [opt('用冷水澆熄它', out('你找到一口井，把冷水往小腹上潑。紋樣滋地一聲暗了下去。', cor(M, -4)),
            out('冷水澆上去，紋樣反而亮得更厲害了。', cor(M, 4), cond('aroused')), ('str', 12), 'fail'),
        opt('靜下心來祈禱', out('你閉上眼睛祈禱，熱流慢慢地退了。', cor(M, -5)),
            out('祈禱的時候，紋樣燙得像要燒穿你的皮膚。', cor(M, 5), cond('dazed')), ('fai', 12), 'fail'),
        opt('找個地方解決', out('你找了個沒人的地方，照著紋樣想要的，用手指讓自己舒服了一次。熱流退去時，紋樣滿足地暗了下來。', cor(M, 6), cond('afterglow')), scene='always')]),
    pe(M, 'mark_dream', '契約的夢', [0, 1, 2], ['rest'],
       '夢裡有個聲音，甜得像蜜：「你帶著我的契紋到處跑呢。乖孩子。今晚要不要來找我？」',
       '主角在夢裡被刻下契紋的魅魔召喚，魅魔撫摸著發光的紋樣，一邊低語契約的條款，一邊用舌尖與手指讓主角在夢裡高潮。',
       [opt('在夢裡拒絕她', out('「不要。」你說。她笑了笑，聲音淡了下去：「總有一天你會來的。」', cor(M, -5)),
            out('你想拒絕，聲音卻變成了呻吟。', cor(M, 5), cond('dazed'), cond('afterglow')), ('fai', 13), 'fail'),
        opt('問她契約的內容', out('你逼問她契約寫了什麼。她沒有回答，只說了一個名字——薇絲佩菈——就消失了。', cor(M, -2)),
            out('她用一個吻堵住了你的問題。', cor(M, 5), cond('afterglow')), ('int', 13), 'fail'),
        opt('「我去。」', out('你在夢裡走向她。醒來時床單濕了一片，小腹的紋樣比昨天更亮了一點。', cor(M, 7), hp(0.1), cond('afterglow')), scene='always')]),
    pe(M, 'mark_glow', '紋樣發亮', [1, 2], ['step'],
       '紋樣在人群裡亮了起來，連隔著衣服都看得見。有人指著你的小腹竊竊私語，有人的眼神變得很奇怪。',
       '契紋在眾目睽睽下發亮，主角的身體跟著發熱，被路人的目光撫摸著；有個大膽的人湊了上來，主角沒能推開他的手。',
       [opt('用斗篷遮住它', out('你拉緊斗篷，低著頭快步離開。光被遮住了，議論聲也停了。', cor(M, -4)),
            out('斗篷遮住了光，遮不住你的臉紅。', cor(M, 5), cond('aroused')), ('dex', 12), 'fail'),
        opt('說這是新流行的刺青', out('「新流行的刺青，會發光喔。」你眨了眨眼。大家笑了，事情就這樣過去了。', cor(M, -4)),
            out('你說話時紋樣閃了一下，有人倒吸了一口氣。', cor(M, 5), cond('aroused'), cond('disheveled')), ('cha', 13), 'fail'),
        opt('任人看個夠', out('你任由人們盯著發光的紋樣看，有人伸手碰了它，你沒有躲。', cor(M, 7), cond('afterglow')), scene='always')]),
    pe(M, 'mark_thirst', '渴', [1, 2], ['travel'],
       '旅途上，紋樣讓你一直很渴——不是喉嚨的渴。你一路都在偷看同伴的手、同伴的嘴唇。',
       '契紋讓主角渴望觸碰，旅途中主角在同伴睡著時忍不住貼近、撫摸自己，在紋樣的催促下一次又一次地高潮。',
       [opt('拉開距離，專心趕路', out('你走在最前面，盯著路，數著步子。渴慢慢地退了。', cor(M, -4)),
            out('越想專心，腦子裡越是那些畫面。', cor(M, 5), cond('aroused')), ('fai', 13), 'fail'),
        opt('喝點烈酒壓下去', out('烈酒燒過喉嚨，把另一種渴也燒掉了。', cor(M, -3)),
            out('酒讓你更大膽了。', cor(M, 5), cond('aroused')), ('str', 12), 'fail'),
        opt('晚上偷偷解渴', out('那一晚你在睡袋裡，咬著手背，讓自己解了渴。紋樣滿足地暗了下去。', cor(M, 6), cond('afterglow')), scene='always')]),
    pe(M, 'mark_lure', '被吸引的目光', [1, 2, 3], ['step'],
       '紋樣散發著魅魔的氣息。路過的人一個接一個地停下來看你，其中一個走了過來，眼神迷濛：「我們……是不是在哪裡見過？」',
       '被契紋吸引的路人把主角帶進暗巷，紋樣在兩人身體貼合時亮得刺眼；主角在魅魔的魔力推動下，主動迎合著陌生人。',
       [opt('打斷魅惑', out('你在他面前打了一個響指。他眨了眨眼，滿臉困惑地走開了。', cor(M, -4)),
            out('響指沒有用。他的手已經放在你的腰上了。', cor(M, 5), cond('aroused')), ('cha', 14), 'fail'),
        opt('用斗篷遮住紋樣離開', out('你遮住紋樣，鑽進人群。那股氣息散了。', cor(M, -3)),
            out('來不及了，他跟了上來。', cor(M, 5), cond('aroused')), ('dex', 13), 'fail'),
        opt('「也許見過。」', out('你牽著他走進暗巷。他離開時恍恍惚惚的，你的小腹卻暖洋洋的，身體輕得像要飄起來。', cor(M, 8), hp(0.1), cond('afterglow')), scene='always')]),
    pe(M, 'mark_summon', '魅魔的召喚', [2, 3], ['rest'],
       '這一次不是夢。你睜開眼睛，發現自己站在一個粉紫色的房間裡，薇絲佩菈翹著腳坐在床上：「契紋夠深了，我可以直接把你叫來了。過來，續約的時間到了。」',
       '魅魔薇絲佩菈在契約的空間裡「續約」：她用舌頭描摹主角小腹上的紋樣，一筆一筆地加深，每加深一筆就讓主角高潮一次。',
       [opt('掙脫召喚', out('你用盡意志從那個房間裡逃了出來，醒在自己的床上，全身是汗。', cor(M, -7)),
            out('門是鎖著的。她笑著拍了拍身邊的位子。', cor(M, 6), cond('drained'), cond('afterglow')), ('fai', 15), 'fail'),
        opt('找出契約空間的破綻', out('你在房間的角落找到一道裂縫，從裂縫鑽了出去。她在背後大笑：「聰明的孩子！」', cor(M, -5)),
            out('那道裂縫是她故意留的——後面是另一張床。', cor(M, 6), cond('afterglow')), ('int', 15), 'fail'),
        opt('躺到她身邊', out('你躺到她身邊。續約很長、很溫柔。你醒來時，身上的疲憊一掃而空。', cor(M, 9), hp(0.2), cond('afterglow')), scene='always')]),
    pe(M, 'mark_move', '身體自己動', [2, 3], ['step'],
       '你的腳自己轉了方向，走向一個陌生人。你的手自己伸了出去，勾住了他的衣領。紋樣在發燙——它在替你選人。',
       '契紋操縱主角的身體，主角像被線牽著的人偶一樣主動貼上陌生人、解開衣服、跨坐上去，意識清醒卻無法停下。',
       [opt('奪回身體', out('你咬破嘴唇，用痛把自己拉回來。手鬆開了，你對陌生人道了歉，落荒而逃。', cor(M, -7), hp(-0.05)),
            out('痛也沒用。你的身體已經不是你的了。', cor(M, 6), cond('dazed'), cond('afterglow')), ('fai', 15), 'fail'),
        opt('把他推開', out('你用力推開他，自己也跌坐在地上。紋樣不甘心地暗了下去。', cor(M, -5)),
            out('推開的手變成了撫摸。', cor(M, 6), cond('afterglow')), ('str', 14), 'fail'),
        opt('隨它去', out('你不再抵抗，任由紋樣帶著你的身體去做它想做的事。結束之後，你站在原地，好一會兒才想起自己是誰。', cor(M, 9), cond('dazed'), cond('afterglow')), scene='always')]),
    pe(M, 'mark_camp', '夜營的低語', [2, 3], ['travel'],
       '營地裡，紋樣在毯子底下一閃一閃，薇絲佩菈的聲音在你的耳邊：「你的同伴睡得好熟呢。去吧，去把他們叫醒。」',
       '契紋的低語讓主角爬向熟睡的同伴，主角在半推半就之間與同伴纏綿，紋樣的光把帳篷照成了粉紅色。',
       [opt('捂住耳朵', out('你把頭埋進毯子裡，一遍一遍地念著自己的名字。低語停了。', cor(M, -5)),
            out('聲音是從你身體裡面傳出來的，捂不住。', cor(M, 5), cond('aroused')), ('fai', 14), 'fail'),
        opt('離開營地走一走', out('你走進夜色裡，讓冷風吹散了低語。', cor(M, -3)),
            out('夜色裡，低語變得更清楚了。', cor(M, 5), cond('aroused')), ('str', 13), 'fail'),
        opt('照她說的做', out('你鑽進了同伴的毯子裡。第二天早上，大家都很有默契地沒有提起昨晚的事。', cor(M, 8), cond('afterglow')), scene='always')]),
    pe(M, 'mark_other_half', '契約的另一半', [3], ['step', 'rest'],
       '紋樣亮得像一顆心臟在跳。薇絲佩菈的身影浮現在你的眼前，伸手撫上你的小腹：「快了。再深一點，你就整個是我的了。」',
       '薇絲佩菈的幻影抱住主角，手指沒入發光的紋樣，彷彿直接撫摸主角的子宮；主角在幻影的懷裡一次又一次地失神。',
       [opt('「我不是妳的。」', out('你抓住她的手腕，把它從紋樣上拉開。她的幻影晃了晃，第一次露出了驚訝的表情。', cor(M, -10)),
            out('你的聲音太小了，小到連你自己都不相信。', cor(M, 6), cond('dazed'), cond('afterglow')), ('fai', 16), 'fail'),
        opt('反過來逼問她的真名', out('你直視她的眼睛，逼她說出真名的一半。她咬著嘴唇消失了——你握住了契約的一角。', cor(M, -6)),
            out('她用一個深吻回答了你。', cor(M, 6), cond('afterglow')), ('cha', 16), 'fail'),
        opt('靠進她的懷裡', out('你靠進她的懷裡。那是你這輩子最溫暖的一次擁抱。幻影散去時，你全身的傷都好了。', cor(M, 10), hp(0.3), cond('afterglow')), scene='always')]),
    pe(M, 'mark_prayer', '祈禱時的灼痛', [1, 2, 3], ['step', 'rest'],
       '你想祈禱，可是一開口，紋樣就像烙鐵一樣燙了起來。魅魔的契約不喜歡神的名字。',
       '契紋在主角祈禱時發作，灼熱化成了快感，主角跪在地上，祈禱的字句斷斷續續地變成了呻吟。',
       [opt('忍著痛把祈禱念完', out('你忍著灼痛把祈禱一字一字地念完。紋樣的光弱了一點。', cor(M, -6), hp(-0.1)),
            out('念到一半，你就跪下了。', cor(M, 5), cond('dazed')), ('fai', 15), 'fail'),
        opt('換一種方式祈禱', out('你不出聲，只在心裡默念。紋樣沒有察覺。', cor(M, -4)),
            out('紋樣聽得見你的心聲。', cor(M, 5), cond('dazed')), ('int', 14), 'fail'),
        opt('放棄祈禱', out('你放棄了祈禱，紋樣的灼熱化成了一陣舒服的暖流。你在暖流裡睡著了。', cor(M, 6), cond('afterglow')), scene='always')]),

    # ---------------- 寄生植物的種子 ----------------
    pe(S, 'seed_stir', '種子動了', [0, 1], ['step', 'rest'],
       '肚子裡的種子動了一下。溫溫的，像有什麼東西在你身體深處翻身。',
       '寄生的種子在主角體內蠕動，細小的根鬚輕輕搔刮著敏感的內壁，主角捂著肚子，腿一陣一陣地發軟。',
       [opt('喝下驅蟲的藥草茶', out('藥草茶苦得要命，種子安靜了下來，好像長得慢了一點。', cor(S, -10)),
            out('藥草茶沒有用。', cor(S, 5), cond('sensitive')), ('int', 12), 'fail'),
        opt('忍著', out('你按著肚子忍了過去。', cor(S, -3)),
            out('它動得越來越厲害。', cor(S, 5), cond('sensitive')), ('fai', 12), 'fail'),
        opt('躺下來感覺它', out('你躺下來，手放在肚子上，感覺著它的每一下動靜，直到身體跟著它一起顫抖。', cor(S, 5), cond('afterglow')), scene='always')]),
    pe(S, 'seed_root', '紮根', [1, 2], ['step', 'travel', 'rest'],
       '種子紮根了。細細的根鬚在你身體裡伸展，每伸展一點，就有一股甜甜的麻癢擴散開來。',
       '種子在主角體內紮根，根鬚纏繞、伸展，從裡面撫弄著主角；主角蜷縮著，在一波一波的快感裡感覺自己被一點一點地佔據。',
       [opt('用火烤過的刀逼退根鬚', out('你把燒紅的刀背貼在小腹上。根鬚怕熱，縮了回去。', cor(S, -12), hp(-0.1)),
            out('你下不了手。', cor(S, 6), cond('sensitive'), cond('aroused')), ('str', 14), 'fail'),
        opt('靜下心，用意志壓住它', out('你一動也不動地坐了一個小時，根鬚停止了伸展。', cor(S, -6)),
            out('越想壓住，它長得越快。', cor(S, 6), cond('aroused')), ('fai', 14), 'fail'),
        opt('任它紮根', out('你任它紮根。那種被從裡面填滿的感覺，讓你好一陣子什麼都想不了。', cor(S, 8), cond('afterglow')), scene='always')]),
    pe(S, 'seed_bloom', '開花', [3], ['step', 'travel', 'rest'],
       '它要出來了。小腹一陣一陣地收縮，種子已經長成了一朵花苞，正從你身體深處慢慢地往外推。',
       '寄生植物在主角體內開花，花苞一點一點地被推出來，花瓣擦過每一寸敏感的內壁；主角在連續不斷的高潮裡把它產了下來。',
       [opt('咬牙把它推出來', out('你咬著毛巾，用盡力氣。一朵濕漉漉的白花滑了出來，在你手心裡慢慢綻放——它結束了。花可以拿去賣。',
                             {"type": "parasite", "parasite": S, "op": "remove"}, money(150), cond('drained')),
            out('它卡住了，你脫力地躺著，任它自己慢慢地出來。最後它還是出來了——帶著你所有的力氣。',
                {"type": "parasite", "parasite": S, "op": "remove"}, cond('drained'), cond('afterglow')), ('str', 13), 'fail'),
        opt('享受它出來的過程', out('你沒有用力，只是躺著，感覺著花瓣一片一片地擦過。它出來的時候，你叫得很大聲。手心裡的白花香得讓人頭暈。',
                             {"type": "parasite", "parasite": S, "op": "remove"}, money(150), cond('afterglow')), scene='always')]),
    pe(S, 'seed_sap', '甜蜜的汁液', [2, 3], ['step', 'rest'],
       '種子分泌出一種甜甜的汁液，從你的身體裡流出來。聞到味道的蟲子、小動物，甚至路人，都轉過頭來看你。',
       '寄生植物的汁液讓主角的身體變得黏膩而敏感，被香味吸引的觸手藤蔓從草叢裡伸出來，貪婪地舔舐著主角。',
       [opt('把汁液洗掉', out('你跳進河裡，把身體洗得乾乾淨淨。香味散了。', cor(S, -6)),
            out('洗不完，越洗流得越多。', cor(S, 5), cond('sensitive')), ('dex', 13), 'fail'),
        opt('用香料蓋過味道', out('你在身上抹了濃濃的香料，把甜味蓋了過去。', cor(S, -4)),
            out('香料混著甜味，變成了更誘人的味道。', cor(S, 5), cond('aroused')), ('int', 13), 'fail'),
        opt('讓它們舔個夠', out('你躺在草叢裡，讓聞香而來的藤蔓舔個夠。結束時你黏糊糊的，卻覺得身體輕盈了很多。', cor(S, 6), hp(0.1), cond('afterglow')), scene='always')]),
]

# 契紋相關的小事件（城鎮事件）：酒館裡有人認出了契紋
TOWN = [
    {"id": "tn_mark_glance", "scope": "town", "tier": "normal", "kind": "choice", "cells": ["tavern", "brothel"], "category": "omen",
     "requires": {"parasites": {M: {}}}, "tags": ["adult"], "cooldown_days": 10,
     "title": "認出契紋的人",
     "text": "酒館角落裡，一個戴著兜帽的老婦人一直盯著你的小腹。她招手要你過去，壓低了聲音：「那是薇絲佩菈的紋吧？三百年前，我奶奶也帶著一個一模一樣的。」",
     "scene": "老婦人說起祖母當年被契紋支配的故事，說到一半，主角的契紋亮了起來；老婦人歎口氣，教主角用手指按著紋樣的某一筆、讓它在自己掌控下釋放一次。",
     "options": [
         {"label": "請她多說一點", "check": {"attr": "cha", "dc": 13},
          "success": {"text": "老婦人說，她奶奶最後找到了契約的原本，改寫了它。「契約是兩個人的事，」她說，「只要你夠強，主客是可以顛倒的。」", "effects": [cor(M, -5), {"type": "xp", "amount": 30}]},
          "fail": {"text": "老婦人看了你很久，搖搖頭：「你還不夠想擺脫它。」她把酒錢放在桌上，走了。"}},
         {"label": "請她教你壓住它", "check": {"attr": "fai", "dc": 13},
          "success": {"text": "她教你一段古老的歌謠，唱的時候紋樣的光會變弱。", "effects": [cor(M, -8)]},
          "fail": {"text": "你唱走了音，紋樣反而亮了起來。老婦人歎了口氣，教了你另一種方法——讓它在你的掌控下發洩一次。", "effects": [cor(M, 3), cond('afterglow')]},
          "adult_scene": "fail"},
         {"label": "裝作沒聽懂", "success": {"text": "你笑了笑，說那只是普通的刺青。老婦人沒有再說什麼。"}},
     ]},
]


def write():
    open(R + 'data/rules/parasites.json', 'w').write(json.dumps(RULES, ensure_ascii=False, indent=2) + '\n')
    # 物品：接在吊帶舞孃的吊襪內褲後面
    P = R + 'data/rules/items.json'
    names = {i['name'] for i in ITEMS}
    lines = [l for l in open(P).read().split('\n') if not any(f'"name": "{n}"' in l for n in names)]
    anchor = next(i for i, l in enumerate(lines) if '"name": "吊帶舞孃的吊襪內褲"' in l)
    s = '\n'.join(lines[:anchor + 1] + ['    ' + json.dumps(i, ensure_ascii=False) + ',' for i in ITEMS] + lines[anchor + 1:])
    assert sum(1 for i in json.loads(s)['items'] if i['name'] in names) == len(ITEMS)
    open(P, 'w').write(s)
    # 狀態
    C = R + 'data/rules/companions.json'
    c = open(C).read()
    for k in CONDS:
        c = re.sub(r',\n  "%s": \{.*\}' % k, '', c)
    anchor = '\n  "disheveled": '
    a = c.index(anchor)
    line_end = c.index('\n', a + 1)
    rel = c[a:line_end]
    comma = rel.endswith(',')
    add = ''.join(',\n  "%s": %s' % (k, json.dumps(v, ensure_ascii=False)) for k, v in CONDS.items())
    c = c[:a] + rel.rstrip(',') + add + (',' if comma else '') + c[line_end:]
    assert all(k in json.loads(c)['conditions'] for k in CONDS)
    open(C, 'w').write(c)
    # 事件：接在模板陣列的最後
    T = R + 'data/rules/travel_events.json'
    s = open(T).read()
    ids = [e['id'] for e in E + TOWN]
    s = '\n'.join(l for l in s.split('\n') if not any(l.startswith(f'    {{"id": "{i}"') for i in ids))
    end = s.index('\n  ],\n  "town": {')
    head = s[:end].rstrip().rstrip(',')
    s = head + ',\n' + ',\n'.join('    ' + json.dumps(e, ensure_ascii=False) for e in E + TOWN) + s[end:]
    data = json.loads(s)
    assert sum(1 for t in data['templates'] if t['id'] in ids) == len(ids)
    open(T, 'w').write(s)
    print('parasites', len(RULES['parasites']), 'events', len(E), 'town', len(TOWN))


if __name__ == '__main__':
    assert len({e['id'] for e in E}) == len(E)
    for e in E + TOWN:
        assert len(e['title']) <= 20 and len(e['text']) <= 400 and len(e.get('scene', '')) <= 200, e['id']
        for o in e['options']: assert len(o['label']) <= 30, o['label']
    write()
