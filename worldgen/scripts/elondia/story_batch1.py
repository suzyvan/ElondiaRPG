"""第一批特殊任務：晨曦王位之爭、低語墓穴、莉莉安（魔法少女）。可以重跑：先拿掉這批的 id 再加回去。"""
import json

P = 'data/rules/stories.json'


def aff(npc, d, why):
    return {"type": "affinity", "npc": npc, "delta": d, "reason": why}


def mem(text, imp=2):
    return {"type": "memory", "summary": text, "importance": imp}


def money(n):
    return {"type": "money", "amount": n}


def rep(f, d):
    return {"type": "reputation", "faction": f, "delta": d}


def at_cell(loc, cell):
    return {"where": "cell", "location": loc, "cell": cell}


def at_npc(npc):
    return {"where": "npc", "npc": npc}


def at_dun(loc, layer):
    return {"where": "dungeon", "location": loc, "layer": layer}


def need(*flags):
    return {"flags": list(flags)}


ANA, ALX, KING, LOR, LIL = 'npc_anastasia', 'npc_alexei', 'npc_alexander', 'npc_lorenzo_valois', 'npc_lilian'

# ---------------- 晨曦王位之爭 ----------------
dawn1 = {
    "id": "dawn_throne_ambush",
    "title": "遇襲的樞機馬車",
    "summary": "晨曦王國的公主、樞機主教安納塔西亞在回王都的官道上遇襲。刺客身上的徽記指向她的王兄——太明顯了，明顯得像是有人希望她這麼想。（晨曦王位之爭・一）",
    "rank": "D",
    "merit": 8,
    "start": {
        "kind": "travel", "chance": 0.25, "regions": ["central"], "min_level": 5,
        "text": "前方的官道上傳來金鐵交擊聲：一輛掛著聖環紋章的緋紅馬車翻倒在路邊，護衛倒了一地，蒙面的刺客正逼向車門。車裡傳出一個沉靜的女聲：「想要我的命，就自己進來拿。」",
    },
    "start_flags": ["dthr_ambush"],
    "nodes": [
        {
            "id": "ambush", "title": "在官道上擊退襲擊馬車的刺客",
            "text": "三名刺客回過頭來，黑巾下只露出一雙眼睛，手上的短刃泛著青光。翻倒的車廂裡，一隻戴著鑲金聖環的手正握著法杖，指節發白。",
            "at": {"where": "road"}, "requires": need("dthr_ambush"), "kind": "combat", "urgent": True,
            "enemies": [["dusk_blade_assassin", 3]],
            "success": {
                "text": "最後一名刺客倒下前咬碎了嘴裡的毒囊。車門打開，一位穿著緋紅法衣、身形嬌小的半精靈走下來，拍掉裙擺上的灰：「身手不錯。我是安納塔西亞——這個國家的公主，也是這個教區的樞機主教。送我回晨光城，報酬不會少。」",
                "set_flags": ["dthr_saved"], "join": ANA,
                "effects": [aff(ANA, 10, "在官道上救了她")],
            },
            "fail": {
                "text": "你們被逼退到路邊。刺客正要得手時，遠處傳來聖殿騎士的號角，他們丟下一句「下次」便遁入林中。公主看了你一眼：「至少你們拖住了他們。一起走吧，路上我有話問你。」",
                "set_flags": ["dthr_saved"], "join": ANA,
            },
        },
        {
            "id": "escort", "title": "把公主送到晨光城的城門",
            "text": "晨曦門的守衛一見公主就變了臉色，急忙通報。安納塔西亞在城門下停住腳步，從袖中取出一枚從刺客身上搜來的黑鐵徽記——一隻銜著劍的獅鷲。「王兄近衛的紋章。」她淡淡地說，「太明顯了，明顯得像是有人希望我這麼想。」",
            "at": at_cell("dawnlight", "gate"), "requires": need("dthr_saved"), "kind": "story",
            "success": {
                "text": "她把徽記交給你：「替我查清楚它是從哪裡來的。宮裡的人我一個也不能信，你是外人，反而乾淨。」說完便在騎士的簇擁下往王城去了。",
                "set_flags": ["dthr_token"], "leave": ANA,
            },
        },
        {
            "id": "token", "title": "到晨光城的情報商追查黑鐵徽記",
            "text": "日輪廣場角落的情報商把徽記翻來覆去看了很久，手指在獅鷲的眼睛上停住：「做工很好，好到不像軍需處的東西。你想知道是誰訂的？那可不是普通的價錢。」",
            "at": at_cell("dawnlight", "informant"), "requires": need("dthr_token"), "kind": "check",
            "check": {"attr": "cha", "dc": 14},
            "success": {
                "text": "情報商壓低聲音：這批徽記是三個月前在鐵匠街訂做的，付的是阿爾貝納的金幣，來取貨的僕人手上戴著一枚紫水晶戒指——那是瓦洛公爵家僕役的標記。洛倫佐公爵，國王的姪子，王位的砝碼。",
                "set_flags": ["dthr_truth"],
            },
            "fail": {
                "text": "情報商收了一筆封口費才肯開口：徽記是假的，訂貨的是某位大貴族家的僕人。至於是哪一位，他寧可不知道——「在這座城裡，知道太多的人睡不安穩。」",
                "set_flags": ["dthr_truth"], "effects": [money(-100)],
            },
        },
        {
            "id": "report", "title": "向安納塔西亞回報徽記的來歷",
            "text": "安納塔西亞在王城外的迴廊裡接見你，緋紅的法衣換成了素白的常服。她聽你說完，指尖輕輕敲著欄杆，沒有說話——她在等你決定，這份情報到底要交給誰。",
            "at": at_npc(ANA), "requires": need("dthr_truth"), "kind": "choice",
            "options": [
                {
                    "label": "如實告訴她",
                    "success": {
                        "text": "安納塔西亞只是笑了笑：「堂兄想讓我們兄妹先咬起來，好把自己的價碼抬高。」她把徽記收進袖中：「這枚棋子我先留著。你也是——等時候到了，我會再找你。」",
                        "set_flags": ["dthr_1_done", "dthr_told_princess"],
                        "effects": [aff(ANA, 10, "替她查出刺殺的幕後"), mem("在官道上救了安納塔西亞公主，查出刺殺是洛倫佐公爵安排的，如實告訴了她。")],
                        "complete": True,
                    },
                },
                {
                    "label": "推說線索斷了，私下告訴皇子",
                    "success": {
                        "text": "你推說線索斷了。當晚，你把徽記和情報商的話一起送進了皇子的營房。阿列克謝大笑著拍你的肩：「我妹妹以為是我？好，讓她這麼以為吧——這份人情我記下了。等老頭子撐不住的那天，我要你站在我這邊。」",
                        "set_flags": ["dthr_1_done", "dthr_told_prince"],
                        "effects": [aff(ALX, 15, "私下告訴他刺殺的真相"), aff(ANA, -5, "對她有所隱瞞"), mem("在官道上救了安納塔西亞公主，卻把刺殺的真相私下告訴了阿列克謝皇子。")],
                        "complete": True,
                    },
                },
            ],
        },
    ],
    "rewards": [money(300), {"type": "xp", "amount": 450}],
}

dawn2 = {
    "id": "dawn_throne_poison",
    "title": "老獅子的病",
    "summary": "國王亞歷山大昏睡的時間越來越長。洛倫佐公爵請你查清楚，御醫口中的「年紀大了」到底是什麼。（晨曦王位之爭・二）",
    "rank": "C",
    "merit": 10,
    "start": {
        "kind": "npc", "npc": LOR, "min_level": 8, "requires": need("dthr_1_done"),
        "text": "洛倫佐公爵在沙龍的角落向你舉杯，七枚戒指在燭光下閃爍：「我的兩位堂兄妹都在打聽你。別緊張，我只是想請你幫個小忙——叔父最近昏睡的時間越來越長，御醫說是年紀大了。我不太相信御醫。」",
    },
    "start_flags": ["dthr_poison"],
    "nodes": [
        {
            "id": "academy", "title": "到晨光城的治癒者學院化驗國王的湯藥",
            "text": "洛倫佐弄來了一小瓶國王每晚服用的安神湯。治癒者學院的院長把湯藥倒進銀盤，盤底慢慢浮出一圈灰紫色的紋路。",
            "at": at_cell("dawnlight", "lm_healers_academy"), "requires": need("dthr_poison"), "kind": "check",
            "check": {"attr": "int", "dc": 15},
            "success": {
                "text": "「暮影蓮。」院長臉色發白，「少量服用只會讓人嗜睡，日積月累就會奪走神智。這種花只長在晨霧修道院的深層，見光就枯——採花的人一定還會回去。」",
                "set_flags": ["dthr_lotus"],
            },
            "fail": {
                "text": "你們試了一整晚，只知道湯裡混了某種會讓人嗜睡的花粉。院長翻遍了藥典，最後指著一行模糊的字：「這種花……也許只長在晨霧修道院的深層。」",
                "set_flags": ["dthr_lotus"],
            },
        },
        {
            "id": "abbey", "title": "在晨霧修道院遺址深層找到採花的毒師",
            "text": "深層的迴廊裡長滿了灰紫色的蓮花。一個披著學者長袍的男人蹲在花叢間，把花瓣收進鉛盒。他抬頭看見你們，嘆了口氣：「又是來滅口的？我已經照約定送過最後一批了。」霧裡浮出審判官的亡影，他趁亂抽出了沾毒的匕首。",
            "at": at_dun("mist_abbey", "deep"), "requires": need("dthr_lotus"), "kind": "combat",
            "enemies": [["court_poisoner", 1], ["inquisitor_shade", 1]],
            "success": {
                "text": "毒師倒在蓮花叢裡。鉛盒底下壓著一疊信，蓋著不同的封蠟：有皇子近衛的獅鷲、有樞機主教的聖環——還有一封沒有封蠟，只用紫色墨水寫著「照舊」。",
                "set_flags": ["dthr_letters"],
            },
            "fail": {
                "text": "毒師趁你們被亡影纏住時逃進了霧裡，只留下打翻的鉛盒和幾封來不及帶走的信：獅鷲、聖環，還有一封只用紫色墨水寫著「照舊」。",
                "set_flags": ["dthr_letters"],
            },
        },
        {
            "id": "choose", "title": "把信交給洛倫佐公爵",
            "text": "洛倫佐把信一封封攤在桌上。他的笑容第一次淡了下來：「兩邊的封蠟都是真的——我的堂兄妹都樂見老人家早點睡著，也都樂見對方背上罪名。至於這封紫色的……」他把那封信放到燭火上，「就當作沒看見吧。」他轉向你：「你看過這些信。你說，貴族的票該投給誰？」",
            "at": at_npc(LOR), "requires": need("dthr_letters"), "kind": "choice",
            "options": [
                {
                    "label": "支持安納塔西亞公主",
                    "success": {
                        "text": "「公主嗎？教廷的錢、精靈的血統，還有一顆想和魔族談條件的腦袋。」洛倫佐輕輕敲著桌面，「也好，打仗太花錢了。叔父還能撐幾個月——學院的解藥救不回他，但能讓他走得清醒一點。到時候，我會派人找你。」",
                        "set_flags": ["dthr_2_done", "dthr_back_princess"],
                        "counters": {"human_stance": 1},
                        "effects": [aff(ANA, 10, "勸公爵支持她"), aff(LOR, 5, "查出國王的病因"), mem("查出國王亞歷山大被下了暮影蓮的毒，勸洛倫佐公爵支持安納塔西亞公主繼位。")],
                        "complete": True,
                    },
                },
                {
                    "label": "支持阿列克謝皇子",
                    "success": {
                        "text": "「王兄嗎？騎士們愛戴他，他也一直想把魔族趕回荒原。」洛倫佐點點頭，「一個打仗的國王，總比一個比我還會算計的女王好駕馭。叔父還能撐幾個月——學院的解藥救不回他，但能讓他走得清醒一點。到時候，我會派人找你。」",
                        "set_flags": ["dthr_2_done", "dthr_back_prince"],
                        "counters": {"human_stance": -1},
                        "effects": [aff(ALX, 10, "勸公爵支持他"), aff(LOR, 5, "查出國王的病因"), mem("查出國王亞歷山大被下了暮影蓮的毒，勸洛倫佐公爵支持阿列克謝皇子繼位。")],
                        "complete": True,
                    },
                },
            ],
        },
    ],
    "rewards": [money(600), {"type": "xp", "amount": 900}],
}

dawn3 = {
    "id": "dawn_throne_crown",
    "title": "晨曦的加冕",
    "summary": "老獅子快醒不過來了。洛倫佐公爵的票已經投下，落選的一方卻不打算接受。（晨曦王位之爭・三）",
    "rank": "B",
    "merit": 15,
    "start": {
        "kind": "npc", "npc": LOR, "min_level": 11, "requires": need("dthr_2_done"),
        "text": "洛倫佐公爵把你拉進迴廊的陰影裡，難得沒有笑：「老獅子快醒不過來了。他想在走之前見你一面——別問我為什麼，他說他記得官道上那個救了他女兒的外鄉人。」",
    },
    "start_flags": ["dthr_crown"],
    "nodes": [
        {
            "id": "deathbed", "title": "跟著洛倫佐到國王的病榻前",
            "text": "洛倫佐帶你穿過王城的密道，來到國王的寢宮。亞歷山大躺在厚重的帷幔裡，眼神難得清明。他握住你的手：「我這一生……把孩子當成棋子。替我看著，別讓他們把王國也當成棋盤。」說完這句話，晨曦王國的老獅子闔上了眼睛。",
            "at": at_npc(LOR), "requires": need("dthr_crown"), "kind": "story",
            "success": {
                "text": "喪鐘在黎明時響起。不到一個時辰，城裡就傳開了消息：落選的一方不打算接受洛倫佐的選擇。",
                "set_flags": ["dthr_king_dead"], "deaths": [KING],
            },
        },
        {
            "id": "coup_prince", "title": "在晨光城的城門擋下皇子的近衛",
            "text": "阿列克謝的近衛騎士封鎖了晨曦門，要迎皇子入主王城。帶頭的騎士高舉長劍：「王位是嫡皇子的！讓開，外鄉人！」城樓上，阿列克謝披著深藍的披風，一言不發地看著。",
            "at": at_cell("dawnlight", "gate"), "requires": need("dthr_king_dead", "dthr_back_princess"), "kind": "combat",
            "enemies": [["crimson_guard", 3]],
            "success": {
                "text": "近衛們棄劍跪下。阿列克謝在城樓上沉默良久，最後解下了腰間的佩劍——他輸給了一個外鄉人，也輸給了妹妹。",
                "set_flags": ["dthr_coup_done"],
            },
            "fail": {
                "text": "你們被近衛逼退，所幸聖殿騎士及時趕到，以教廷之名平息了騷亂。阿列克謝交出了城門——只是城裡的人都看見，是教廷替公主奪下了王位。",
                "set_flags": ["dthr_coup_done"],
            },
        },
        {
            "id": "coup_princess", "title": "在晨光城的神殿擋下聖殿騎士",
            "text": "安納塔西亞以樞機主教的身分宣布「王位繼承尚待教廷裁定」，聖殿騎士佔據了日輪廣場的神殿，要在那裡為她加冕。白甲的騎士們在神殿的台階上排成一列，金色的聖環在晨光裡發亮。",
            "at": at_cell("dawnlight", "temple"), "requires": need("dthr_king_dead", "dthr_back_prince"), "kind": "combat",
            "enemies": [["ring_templar", 3]],
            "success": {
                "text": "最後一名聖殿騎士被你繳了械。安納塔西亞從神殿裡走出來，看了看你，又看了看身後的王兄：「這一局是我輸了。」她平靜地說，「但教廷不會忘記今天。」",
                "set_flags": ["dthr_coup_done"],
            },
            "fail": {
                "text": "聖殿騎士守住了神殿，直到阿列克謝帶著近衛趕到。王兄沒有流血就拿下了廣場——可是所有人都看見，是軍隊替他奪下了王位。",
                "set_flags": ["dthr_coup_done"],
            },
        },
        {
            "id": "crown_queen", "title": "參加安納塔西亞的加冕典禮",
            "text": "晨曦聖殿的鐘聲響徹全城。安納塔西亞脫下樞機主教的緋紅法衣，戴上了父王的王冠；洛倫佐在她身後微笑，阿列克謝站在貴族的最前排，臉上看不出表情。典禮結束後，新任女王把你叫到身邊：「你想要什麼？」",
            "at": at_npc(LOR), "requires": need("dthr_coup_done", "dthr_back_princess"), "kind": "choice",
            "options": [
                {
                    "label": "受封為王國的騎士",
                    "success": {
                        "text": "女王親手把劍放在你的肩上：「從今天起，你是晨曦的騎士。我不要你效忠王座——我要你在我也變成棋手的那天，提醒我父王最後說的話。」",
                        "set_flags": ["dthr_queen"], "counters": {"human_stance": 1},
                        "effects": [rep("dawn_kingdom", 10), aff(ANA, 10, "見證她的加冕"), mem("見證安納塔西亞加冕為晨曦王國的女王，受封為王國的騎士。", 3)],
                        "complete": True,
                    },
                },
                {
                    "label": "請女王寬待阿列克謝",
                    "success": {
                        "text": "女王看了王兄一眼，點點頭：「他會是北境的守邊公爵，手上有兵，卻離王都很遠。」阿列克謝在典禮後找到你，聲音沙啞：「我不會謝你。但我記得。」",
                        "set_flags": ["dthr_queen"], "counters": {"human_stance": 1},
                        "effects": [rep("dawn_kingdom", 5), aff(ANA, 5, "見證她的加冕"), aff(ALX, 15, "替他求情"), mem("見證安納塔西亞加冕為晨曦王國的女王，替落敗的阿列克謝求了情。", 3)],
                        "complete": True,
                    },
                },
            ],
        },
        {
            "id": "crown_king", "title": "參加阿列克謝的加冕典禮",
            "text": "晨曦聖殿的鐘聲響徹全城。阿列克謝穿著父王年輕時的騎士板甲，戴上了王冠；洛倫佐在他身後微笑，安納塔西亞站在神職者的最前排，臉上看不出表情。典禮結束後，新王把你叫到身邊：「說吧，你想要什麼？」",
            "at": at_npc(LOR), "requires": need("dthr_coup_done", "dthr_back_prince"), "kind": "choice",
            "options": [
                {
                    "label": "受封為王國的騎士",
                    "success": {
                        "text": "國王大笑著把劍拍在你的肩上：「好！晨曦又多了一位騎士。等我把魔族趕回荒原的那天，你要騎在我身邊。」",
                        "set_flags": ["dthr_king"], "counters": {"human_stance": -1},
                        "effects": [rep("dawn_kingdom", 10), aff(ALX, 10, "見證他的加冕"), mem("見證阿列克謝加冕為晨曦王國的國王，受封為王國的騎士。", 3)],
                        "complete": True,
                    },
                },
                {
                    "label": "請國王寬待安納塔西亞",
                    "success": {
                        "text": "國王皺起眉頭，最後還是揮了揮手：「讓她回教廷當她的樞機主教吧，只要她別再插手王國的事。」安納塔西亞在典禮後找到你，輕聲說：「這份人情，我會用教廷的方式還。」",
                        "set_flags": ["dthr_king"], "counters": {"human_stance": -1},
                        "effects": [rep("dawn_kingdom", 5), aff(ALX, 5, "見證他的加冕"), aff(ANA, 15, "替她求情"), mem("見證阿列克謝加冕為晨曦王國的國王，替落敗的安納塔西亞求了情。", 3)],
                        "complete": True,
                    },
                },
            ],
        },
    ],
    "rewards": [money(1500), {"type": "xp", "amount": 2000}],
}

# ---------------- 低語墓穴 ----------------
whisper1 = {
    "id": "whisper_seal",
    "title": "風中的低語",
    "summary": "低語墓穴附近的村民一連幾夜聽見風裡有人下令，下去的盜墓隊只回來一個人，嘴裡不停念著古帝國語。（低語墓穴・一）",
    "rank": "D",
    "merit": 8,
    "start": {
        "kind": "guild", "location": "rhineburg", "min_level": 5,
        "text": "公會的告示板上貼著一張蓋了帝國軍印的委託：低語墓穴附近的村民一連幾夜聽見風裡有人下令「列隊」「前進」，一支盜墓隊下去之後只回來一個人，在神殿裡不停地說著沒人聽得懂的古帝國語。",
    },
    "start_flags": ["whcr_start"],
    "nodes": [
        {
            "id": "survivor", "title": "到萊茵堡的神殿聽倖存者說話",
            "text": "倖存的盜墓者被綁在神殿的床上，眼睛直直盯著天花板，嘴裡反覆念著一串古帝國語。神官說他三天沒睡了，每到半夜就會坐起來，朝著東南方行軍禮。",
            "at": at_cell("rhineburg", "temple"), "requires": need("whcr_start"), "kind": "check",
            "check": {"attr": "int", "dc": 13},
            "success": {
                "text": "你聽出那是統一戰爭時的軍令：「封印第三環已破，禁衛列隊，迎陛下歸位。」他們在墓穴的中層打破了什麼東西。",
                "set_flags": ["whcr_heard"],
            },
            "fail": {
                "text": "你只聽得懂幾個字：「封印」「陛下」「中層」。夠了，至少知道該往哪裡去。",
                "set_flags": ["whcr_heard"],
            },
        },
        {
            "id": "seal", "title": "在低語墓穴中層找到被打破的封印",
            "text": "墓道的牆上刻著一圈圈封印陣，其中一圈被鎬子鑿開了缺口，缺口裡滲出灰白的霧。霧裡站起了穿著帝國舊甲的屍妖，牆上殘存的封印也亮了起來，把你們當成了入侵者。",
            "at": at_dun("whisper_crypt", "middle"), "requires": need("whcr_heard"), "kind": "combat",
            "enemies": [["cursed_seal", 1], ["crypt_wight", 2]],
            "success": {
                "text": "霧散去後，你在缺口下撿到半塊刻著將軍名號的封印石。缺口還在，但霧已經不再往外滲——封印的其餘部分似乎還撐得住。",
                "set_flags": ["whcr_stone"],
            },
            "fail": {
                "text": "你們被逼退到樓梯口，霧裡的東西沒有追上來。等你們再摸回去時，缺口旁只剩那半塊封印石，霧已經停了。",
                "set_flags": ["whcr_stone"],
            },
        },
        {
            "id": "report", "title": "把封印石帶回萊茵堡的公會",
            "text": "公會的主管翻來覆去地看著那半塊封印石，臉色越來越難看：石頭上刻的是第二軍團首任將軍的名號——帝國的開國元勳之一。「這件事不是公會管得了的。」他說，「你打算怎麼辦？」",
            "at": at_cell("rhineburg", "guild"), "requires": need("whcr_stone"), "kind": "choice",
            "options": [
                {
                    "label": "交給公會，讓帝國處理",
                    "success": {
                        "text": "主管把石頭鎖進櫃子，額外給了你一筆封口的酬勞：「低語暫時停了。至於墓裡埋了什麼……那是帝國的家務事。」",
                        "set_flags": ["whcr_1_done"],
                        "effects": [money(150), rep("rhine_empire", 3)],
                        "complete": True,
                    },
                },
                {
                    "label": "留下封印石，自己查下去",
                    "success": {
                        "text": "主管猶豫了一下，還是讓你帶走了石頭：「小心點。低語暫時停了，但如果那些東西說的是真的——有人在等他們的陛下回來。」",
                        "set_flags": ["whcr_1_done"],
                        "effects": [{"type": "item", "name": "封印石片", "qty": 1}, mem("在低語墓穴中層找到被盜墓者打破的封印，留下了刻著帝國將軍名號的封印石。")],
                        "complete": True,
                    },
                },
            ],
        },
    ],
    "rewards": [money(250), {"type": "xp", "amount": 450}],
}

whisper2 = {
    "id": "whisper_oath",
    "title": "將軍們的誓約",
    "summary": "一份從帝國檔案館流出的抄本：統一戰爭的最後一夜，四位將軍在皇帝的帳篷裡立了一個誓。後半段藏在墓穴深層的將軍棺槨裡。（低語墓穴・二）",
    "rank": "C",
    "merit": 10,
    "start": {
        "kind": "informant", "location": "rhineburg", "price": 300, "min_level": 8, "requires": need("whcr_1_done"),
        "text": "情報商把一捲發黃的羊皮紙推到你面前：「你在找低語墓穴的事？這是從帝國檔案館流出來的抄本——統一戰爭的最後一夜，四位將軍在皇帝的帳篷裡立了一個誓。原本藏在墓穴深層的將軍棺槨裡，抄本只剩前半段。」",
    },
    "start_flags": ["whcr_oath"],
    "nodes": [
        {
            "id": "read", "title": "到萊茵堡的魔法物品店解讀古帝國語抄本",
            "text": "魔法物品店的老闆戴上單片眼鏡，幫你逐字對照。抄本的前半段是四位將軍的名字與一句誓詞：「為了帝國，我們讓陛下長眠。」後面被燒掉了。",
            "at": at_cell("rhineburg", "magic"), "requires": need("whcr_oath"), "kind": "check",
            "check": {"attr": "int", "dc": 15},
            "success": {
                "text": "老闆指著燒焦的邊緣：「這不是弒君的認罪書。你看這個詞——是『讓他長眠』，不是『殺死他』。他們把皇帝封起來了，用的是陵寢裡的禁衛和巫妖。」誓約的後半段應該還在將軍的棺槨裡。",
                "set_flags": ["whcr_read"],
            },
            "fail": {
                "text": "你們對著燒焦的羊皮紙看了一下午，只確定了一件事：要知道誓約的後半段，得到墓穴深層的將軍棺槨裡去找。",
                "set_flags": ["whcr_read"],
            },
        },
        {
            "id": "coffin", "title": "在低語墓穴深層打開將軍的棺槨",
            "text": "深層的大廳裡排著四座石棺，其中一座的棺蓋已經被推開了一半。守在棺旁的骷髏騎士轉過頭，空洞的眼窩裡亮起藍火；風裡的低語變成了一句清楚的話：「誰也不准打開陛下的門。」",
            "at": at_dun("whisper_crypt", "deep"), "requires": need("whcr_read"), "kind": "combat",
            "enemies": [["skeleton_knight", 2], ["whisper_wraith", 1]],
            "success": {
                "text": "騎士們倒下了。石棺裡是誓約的後半段，用將軍自己的血寫成：「陛下與一位遠古的魔族之王立了血誓，要用帝國百萬人的魂換取永生。我們殺不死他，只能把他和誓約一起封在最深處。若封印破了，請後來的人替我們做完這件事。」",
                "set_flags": ["whcr_truth"],
            },
            "fail": {
                "text": "你們撤出了大廳。低語在背後笑著，那半截用血寫成的誓約卻被風吹到了你的腳邊——像是有人希望你讀到它：皇帝與魔族之王立了血誓，將軍們只能把他封在最深處。",
                "set_flags": ["whcr_truth"],
            },
        },
        {
            "id": "decide", "title": "在萊茵堡的旅店決定誓約的去向",
            "text": "你把兩半誓約攤在旅店的桌上。將軍們弒君的罪名背了兩百年，真相卻是他們封住了一個想拿整個帝國換永生的皇帝。這份東西交出去，會讓帝國的史書改寫；留在身上，也許某天能派上用場。",
            "at": at_cell("rhineburg", "inn"), "requires": need("whcr_truth"), "kind": "choice",
            "options": [
                {
                    "label": "把誓約交給帝國",
                    "success": {
                        "text": "帝國的書記官收下了誓約，答應會派第二軍團去加固封印。你心裡明白，一支軍團擋不住住在最底層的東西——但至少今晚不會有人再聽見低語。",
                        "set_flags": ["whcr_2_done"],
                        "effects": [money(300), rep("rhine_empire", 5)],
                        "complete": True,
                    },
                },
                {
                    "label": "留著誓約，將來親手封印",
                    "success": {
                        "text": "你把誓約收進行囊。封印還能撐一段時間——在那之前，你得變得夠強，強到能走進墓穴的最底層。",
                        "set_flags": ["whcr_2_done"],
                        "effects": [mem("在低語墓穴深層找到四位將軍的血誓：皇帝與遠古的魔族之王立誓換取永生，將軍們只能把他封在最深處。你答應替他們做完這件事。", 3)],
                        "complete": True,
                    },
                },
            ],
        },
    ],
    "rewards": [money(500), {"type": "xp", "amount": 900}],
}

whisper3 = {
    "id": "whisper_emperor",
    "title": "低語皇帝",
    "summary": "低語又開始了，這一次連帝都城牆上的哨兵都聽見了。封印被從裡面撐裂，帝國亡靈禁衛在墓穴底層列隊，迎接他們的陛下。（低語墓穴・三）",
    "rank": "B",
    "merit": 15,
    "start": {
        "kind": "guild", "location": "rhineburg", "min_level": 11, "requires": need("whcr_2_done"),
        "text": "萊茵堡的公會發出了徵召：低語墓穴的低語又開始了，這一次連帝都城牆上的哨兵都聽見了。加固過的封印被從裡面撐裂，有人看見帝國亡靈禁衛在墓穴底層列隊。",
    },
    "start_flags": ["whcr_end"],
    "nodes": [
        {
            "id": "lich", "title": "在低語墓穴底層和守門的巫妖交談",
            "text": "底層的大門前，一具披著宮廷法袍的巫妖拄著法杖擋住了你們。「我是當年的宮廷法師，自願把靈魂鎖進護命匣，替將軍們看守這扇門。」它的聲音沙啞，「封印快撐不住了。你們是來幫我的，還是來放他出去的？」",
            "at": at_dun("whisper_crypt", "abyss"), "requires": need("whcr_end"), "kind": "choice",
            "options": [
                {
                    "label": "說服巫妖一起加固封印",
                    "check": {"attr": "cha", "dc": 16},
                    "success": {
                        "text": "巫妖沉默良久，點了點頭：「我等了兩百年，終於等到一個肯聽完的人。聽好：門後的那位已經不是人了。血誓吃掉了他的神智，只剩一個不肯死的意志——不要試著跟他說話。」它把位置讓給你：「禁衛會衝出來。替我擋住他們。」",
                        "set_flags": ["whcr_lich_ally"],
                    },
                    "fail": {
                        "text": "巫妖不相信你：「每個人都這麼說。」它舉起法杖，一道寒氣掃過你們，你們只好強行闖過去。身後傳來它沙啞的警告：「不要跟他說話……他早就聽不懂了。」",
                        "set_flags": ["whcr_lich_alone"], "effects": [{"type": "hp", "ratio": -0.2}],
                    },
                },
                {
                    "label": "問它門後的皇帝還能不能說話",
                    "check": {"attr": "int", "dc": 16},
                    "success": {
                        "text": "巫妖的眼窩裡閃過一絲光：「你讀過誓約。」它讓開了路：「不能。血誓吃掉了他的神智，他只會重複兩百年前的命令。殺了他也沒用——這座墓穴被歷史之龍阿契隆的回響困住了，兩百年前的那一夜會一次又一次地重演，他也會在王座上重新聚起形體。你能做的，只有打倒他，再把門封上。」",
                        "set_flags": ["whcr_lich_ally"],
                    },
                    "fail": {
                        "text": "巫妖冷笑一聲：「想跟他談？兩百年來，每個想跟他談的人都成了禁衛。」一道寒氣掃過你們，你們只好強行闖過去——身後的低語越來越響。",
                        "set_flags": ["whcr_lich_alone"], "effects": [{"type": "hp", "ratio": -0.2}],
                    },
                },
            ],
        },
        {
            "id": "guards", "title": "在低語墓穴底層擊退列隊的帝國禁衛",
            "text": "門的裂縫裡湧出黑鋼鎧甲的亡靈禁衛，三人一列，踏著兩百年前的步伐向你們推進。帶頭的禁衛舉起長戟，用古帝國語喊出了衝鋒的口令。",
            "at": at_dun("whisper_crypt", "abyss"), "requires": {"flags_any": ["whcr_lich_ally", "whcr_lich_alone"]}, "kind": "combat",
            "enemies": [["imperial_revenant", 3]],
            "success": {
                "text": "最後一名禁衛跪倒在地，鎧甲裡的藍火熄滅了。門的另一邊，千百個聲音同時用古帝國語喊著同一句話：「列隊。迎陛下歸位。」",
                "set_flags": ["whcr_gate"],
            },
        },
        {
            "id": "throne", "title": "在低語墓穴底層擊敗低語皇帝",
            "text": "門後是一座沒有屋頂的王座廳，頭頂透著不知道從哪裡來的星光。王座上的皇帝只剩一副戴著冠冕的骸骨。你開口，他沒有回答——他從來就沒有在聽，只是一遍又一遍地下著兩百年前的命令。最後一名禁衛從陰影裡走出來，護在他身前。",
            "at": at_dun("whisper_crypt", "abyss"), "requires": need("whcr_gate"), "kind": "combat",
            "enemies": [["emperor_of_whispers", 1], ["imperial_revenant", 1]],
            "success": {
                "text": "骸骨崩散，冠冕滾落在你的腳邊。墓穴安靜了片刻——然後，半空中閃過一層層交錯的殘影——歷史之龍「回響編年」阿契隆的回響，王座上的灰燼開始一粒一粒地聚攏。兩百年前的那一夜會一次又一次地重演：每隔一段時間，他就會在王座上重新聚起形體。只要門還封著，他就只能困在這裡。",
                "set_flags": ["whcr_fallen"],
            },
        },
        {
            "id": "seal", "title": "在低語墓穴底層重新封上王座廳的門",
            "text": "灰燼在王座上緩緩旋轉，像一顆還沒成形的心臟。誓約上的封印紋路就刻在門框上，被禁衛撐出的裂縫還在滲著低語。趁他還沒聚起形體，得把門封上。",
            "at": at_dun("whisper_crypt", "abyss"), "requires": need("whcr_fallen"), "kind": "choice",
            "options": [
                {
                    "label": "和巫妖一起重刻封印",
                    "requires": need("whcr_lich_ally"),
                    "success": {
                        "text": "巫妖把護命匣放在門檻上，用自己的魔力替你補上最後一筆：「我會繼續守在這裡。下次他醒來，就還是我和他兩個。」門闔上的那一刻，墓穴裡所有的低語都停了。",
                        "set_flags": ["whcr_sealed"],
                        "effects": [rep("rhine_empire", 5), mem("在低語墓穴的底層打倒了低語皇帝，和守門的巫妖一起重刻封印。歷史之龍阿契隆的回響讓那一夜不斷重演，皇帝還會在王座上重新聚形，但只能困在底層。", 3)],
                        "complete": True,
                    },
                },
                {
                    "label": "照著誓約自己刻下封印",
                    "check": {"attr": "int", "dc": 16},
                    "success": {
                        "text": "你照著誓約上的方法，把將軍們的血誓一筆一畫刻回門上。門闔上的那一刻，墓穴裡所有的低語都停了——至少這一次。",
                        "set_flags": ["whcr_sealed"],
                        "effects": [rep("rhine_empire", 5), mem("在低語墓穴的底層打倒了低語皇帝，照著四位將軍的誓約重新封上王座廳。歷史之龍阿契隆的回響讓那一夜不斷重演，皇帝還會在王座上重新聚形，但只能困在底層。", 3)],
                        "complete": True,
                    },
                    "fail": {
                        "text": "封印刻歪了一筆，門縫裡的低語差點把你拖進去——你只來得及把門重重摔上，用身體頂住。封印勉強撐住了，但你知道它撐不了太久：下次他醒來，還得有人來。",
                        "set_flags": ["whcr_sealed"],
                        "effects": [{"type": "hp", "ratio": -0.3}, rep("rhine_empire", 3), mem("在低語墓穴的底層打倒了低語皇帝，勉強封住了王座廳。他還會在王座上重新聚形。", 3)],
                        "complete": True,
                    },
                },
            ],
        },
    ],
    "rewards": [money(1500), {"type": "xp", "amount": 2000}],
}

# ---------------- 莉莉安：魔法少女的畢業典禮 ----------------
lil1 = {
    "id": "lilian_successor",
    "title": "魔法少女的繼承人候選",
    "summary": "二十五歲的魔法少女莉莉安想要「畢業」。十年來，星之心第一次對別人有了反應——你。考驗可能有一點點丟臉。（莉莉安・一）",
    "tags": ["adult"],
    "rank": "D",
    "merit": 6,
    "start": {
        "kind": "npc", "npc": LIL, "min_affinity": 10, "min_level": 5,
        "text": "莉莉安把一顆發光的星形寶石塞到你面前，寶石裡傳出尖細的聲音：「就是他！候選人！」莉莉安紅著臉解釋：星之心十年來第一次對別人有反應，只要你通過它的考驗，她就能「畢業」了。「考驗……可能有一點點丟臉。只有一點點。」",
    },
    "start_flags": ["lil_start"],
    "nodes": [
        {
            "id": "pose", "title": "在晨光城的城門陪莉莉安喊變身台詞",
            "text": "星之心的第一道考驗：候選人要在人最多的地方，和現任魔法少女一起擺出變身姿勢、喊出完整的台詞。莉莉安已經擺好了姿勢，眼神裡寫著「拜託你快一點」。路過的商隊停下來看熱鬧。",
            "at": at_cell("dawnlight", "gate"), "requires": need("lil_start"), "kind": "check",
            "check": {"attr": "cha", "dc": 13},
            "success": {
                "text": "你喊得比她還大聲。人群爆出掌聲，星之心滿意地閃了閃。變身完的莉莉安滿臉通紅、呼吸急促，偷偷扯著你的袖子：「那個……副作用來了。陪我走一段，不要問。」",
                "set_flags": ["lil_posed"], "effects": [aff(LIL, 5, "陪她喊變身台詞")],
            },
            "fail": {
                "text": "你的台詞卡在一半，人群裡有小孩在笑。星之心勉強給了及格：「氣勢不夠！」莉莉安反而鬆了一口氣——丟臉的不只她一個。",
                "set_flags": ["lil_posed"],
            },
        },
        {
            "id": "phantoms", "title": "在晨光城近郊擊退星之心放出的幻影",
            "text": "第二道考驗：星之心從寶石裡放出它記憶中的「邪惡」——兩團扭曲的星光幻影。「魔法少女要和夥伴並肩作戰！」寶石尖叫著。莉莉安擺好姿勢：「這個我熟！」",
            "at": {"where": "outskirts", "location": "dawnlight"}, "requires": need("lil_posed"), "kind": "combat",
            "enemies": [["star_phantom", 2]], "allies": [LIL],
            "success": {
                "text": "幻影散成星屑。莉莉安收起法杖，突然腿一軟靠在你身上——這次的副作用比平常強烈得多。她把臉埋在你肩上，悶悶地說：「……星之心說，這是因為候選人在旁邊。不要再問了。」",
                "set_flags": ["lil_fought"],
            },
            "fail": {
                "text": "幻影把你們耍得團團轉，最後是莉莉安一記大招收了尾。星之心不滿地閃著：「候選人要更努力！」莉莉安喘著氣，靠在你身上不肯起來。",
                "set_flags": ["lil_fought"],
            },
        },
        {
            "id": "night", "title": "到晨光城的旅店找莉莉安",
            "text": "那天晚上，莉莉安敲了你的房門。她沒有變身，穿著樸素的睡衣，抱著那顆不再說話的寶石：「星之心睡著了。我想……跟你說實話。變身的副作用每次都要好幾個小時才會退，十年來我都是一個人熬過去的。今天是第一次，旁邊有人。」",
            "at": at_cell("dawnlight", "inn"), "requires": need("lil_fought"), "kind": "choice",
            "options": [
                {
                    "label": "讓她留下來",
                    "success": {
                        "text": "她在你身邊待到天亮。發燙的身子一點一點冷靜下來，最後她枕著你的手臂睡著了，嘴角還帶著笑。早上星之心醒來大叫：「候選人和魔法少女的契合度上升了！」莉莉安把寶石塞進了枕頭底下。",
                        "set_flags": ["lil_1_done"],
                        "effects": [aff(LIL, 15, "陪她熬過變身的副作用"), mem("莉莉安變身的副作用發作時，第一次有人陪在她身邊——那個人是你。")],
                        "complete": True,
                    },
                },
                {
                    "label": "陪她聊天到天亮",
                    "success": {
                        "text": "你們聊了一整夜：她十五歲時怎麼撿到寶石、第一次變身有多興奮、二十歲以後被叫「阿姨」有多崩潰。天亮時她伸了個懶腰：「謝謝你。下次的考驗……我會比較有心理準備。」",
                        "set_flags": ["lil_1_done"],
                        "effects": [aff(LIL, 10, "陪她聊到天亮")],
                        "complete": True,
                    },
                },
            ],
        },
    ],
    "rewards": [money(200), {"type": "xp", "amount": 400}],
}

lil2 = {
    "id": "lilian_abbey",
    "title": "星之心的故鄉",
    "summary": "星之心說，要正式認可繼承人，得回到它被找到的地方——晨霧修道院的深層，那裡有「歷代魔法少女的回憶」。（莉莉安・二）",
    "tags": ["adult"],
    "rank": "C",
    "merit": 8,
    "start": {
        "kind": "npc", "npc": LIL, "min_affinity": 20, "min_level": 8, "requires": need("lil_1_done"),
        "text": "莉莉安一臉嚴肅地找到你：「星之心說，要正式認可繼承人，得回到它被找到的地方——晨霧修道院的深層。它說那裡有『歷代魔法少女的回憶』。我十五歲撿到它的時候只敢待在入口……這次我們一起去。」",
    },
    "start_flags": ["lil_abbey"],
    "nodes": [
        {
            "id": "door", "title": "和莉莉安一起闖進晨霧修道院遺址深層",
            "text": "深層的禮拜堂裡，霧影聖騎士與審判官的亡影守著一扇刻滿星紋的門。莉莉安握緊法杖：「十年前我就是在這扇門外撿到它的。」",
            "at": at_dun("mist_abbey", "deep"), "requires": need("lil_abbey"), "kind": "combat",
            "enemies": [["mist_knight", 1], ["inquisitor_shade", 1]], "allies": [LIL],
            "success": {
                "text": "門上的星紋亮了起來。裡面是一間小小的祭室，牆上畫滿了穿著和莉莉安一樣衣服的少女，每個人都捧著那顆寶石。最後一幅畫裡的少女站在一個男人身邊，笑得很幸福。",
                "set_flags": ["lil_room"],
            },
            "fail": {
                "text": "你們被逼退到門邊，莉莉安用身體替你擋下了最後一擊。倒下之前，她的手碰到了門上的星紋——門自己打開了，亡影們像是被什麼嚇退，散進了霧裡。",
                "set_flags": ["lil_room"], "effects": [{"type": "hp", "ratio": -0.1}],
            },
        },
        {
            "id": "murals", "title": "在祭室解讀歷代魔法少女的壁畫",
            "text": "星之心在祭室裡醒了過來，聲音不再尖細，而是一個溫柔的女聲：「每一位魔法少女，都在找到『想守護的人』之後畢業。」莉莉安愣在原地，你湊近去讀壁畫下的古老文字。",
            "at": at_dun("mist_abbey", "deep"), "requires": need("lil_room"), "kind": "check",
            "check": {"attr": "int", "dc": 15}, "allies": [LIL],
            "success": {
                "text": "壁畫的文字寫得很清楚：所謂的「繼承人」，從來不是下一個魔法少女，而是讓魔法少女願意卸下變身的那個人。莉莉安看著你，耳朵紅到脖子：「所、所以候選人的意思是……」",
                "set_flags": ["lil_read"],
            },
            "fail": {
                "text": "你讀不懂古老的文字，但星之心替你翻譯了——用一種讓莉莉安想挖個洞鑽進去的方式：「就是男朋友的意思喔。」",
                "set_flags": ["lil_read"],
            },
        },
        {
            "id": "answer", "title": "回答莉莉安",
            "text": "回到晨光城之後，莉莉安躲了你三天。第四天，她穿著變身前的樸素衣服攔住你，緊緊捏著那顆寶石：「星之心說，最後一道考驗要等它的魔力恢復。在那之前……我想先聽你的回答。不是候選人的回答，是你的。」",
            "at": at_npc(LIL), "requires": need("lil_read"), "kind": "choice",
            "options": [
                {
                    "label": "告訴她你願意",
                    "success": {
                        "text": "莉莉安呆了三秒，然後大叫一聲撲進你懷裡，差點把你撞倒。星之心在她手裡閃得像煙火。「等最後的考驗結束，」她把臉埋在你胸口，小聲說，「我就畢業。然後……我們再看看。」",
                        "set_flags": ["lil_2_done"],
                        "effects": [aff(LIL, 20, "答應了她的心意"), mem("在晨霧修道院的祭室裡知道了星之心的真相，答應了莉莉安的心意。", 3)],
                        "complete": True,
                    },
                },
                {
                    "label": "說你還需要一點時間",
                    "success": {
                        "text": "莉莉安用力點頭：「我懂！我等了十年，再等一下也沒關係。」她把寶石收好，笑得有點勉強，又有點期待。",
                        "set_flags": ["lil_2_done"],
                        "effects": [aff(LIL, 5, "認真看待她的心意")],
                        "complete": True,
                    },
                },
            ],
        },
    ],
    "rewards": [money(300), {"type": "xp", "amount": 900}],
}

lil3 = {
    "id": "lilian_graduation",
    "title": "魔法少女的畢業典禮",
    "summary": "星之心的魔力恢復了。最後的考驗是打倒歷代魔法少女留在寶石裡的殘影——她們要確認，莉莉安真的找到了可以放手的理由。（莉莉安・三）",
    "tags": ["adult"],
    "rank": "B",
    "merit": 10,
    "start": {
        "kind": "npc", "npc": LIL, "min_affinity": 30, "min_level": 11, "requires": need("lil_2_done"),
        "text": "莉莉安換上那套短到大腿根的魔法少女服——也許是最後一次了。她轉了一圈，有點不好意思：「最後的考驗，是打倒歷代魔法少女留在寶石裡的殘影。她們要確認，我真的找到了可以放手的理由。陪我去吧。」",
    },
    "start_flags": ["lil_grad"],
    "nodes": [
        {
            "id": "shadows", "title": "在晨光城近郊擊敗歷代魔法少女的殘影",
            "text": "星之心在空中展開，十幾道穿著不同年代魔法少女服的身影從星光裡走出來，一個接一個退下，最後只剩兩位最強的前輩。「想畢業，就讓我們看看妳身邊的人。」",
            "at": {"where": "outskirts", "location": "dawnlight"}, "requires": need("lil_grad"), "kind": "combat",
            "enemies": [["first_star_heir", 1], ["star_shadow", 1]], "allies": [LIL],
            "success": {
                "text": "殘影們微笑著散成星屑。最後一位前輩在消失前摸了摸莉莉安的頭：「恭喜畢業。」星之心落回莉莉安手裡，光芒漸漸淡去。",
                "set_flags": ["lil_won"],
            },
        },
        {
            "id": "ceremony", "title": "到晨光城的神殿舉行畢業典禮",
            "text": "莉莉安把星之心放在神殿的祭壇上，主持了一場只有兩個人的畢業典禮。她最後一次喊出變身台詞，然後解除變身——這一次，副作用沒有出現。「它真的放我走了。」她笑著，眼淚掉了下來，「我現在只是個普通的二十五歲冒險者了。普通到可以……跟某個人一起過日子。」",
            "at": at_cell("dawnlight", "temple"), "requires": need("lil_won"), "kind": "choice",
            "options": [
                {
                    "label": "邀她一起旅行",
                    "success": {
                        "text": "「真的？」莉莉安差點又要擺出變身姿勢，硬生生忍住了。她牽起你的手，十指緊扣：「那就說好了——以後換我守護你。白天和晚上都是。」",
                        "set_flags": ["lil_graduated"],
                        "effects": [aff(LIL, 15, "畢業之後選擇了你"), mem("莉莉安從魔法少女畢業了，和你一起踏上旅途。", 3), {"type": "companion", "npc": LIL, "mode": "voluntary"}],
                        "complete": True,
                    },
                },
                {
                    "label": "約好以後常去找她",
                    "success": {
                        "text": "她在神殿門口踮起腳，在你嘴唇上輕輕碰了一下：「隨時來找我。我現在有的是時間——晚上也是。」",
                        "set_flags": ["lil_graduated"],
                        "effects": [aff(LIL, 15, "畢業之後選擇了你"), mem("莉莉安從魔法少女畢業了，成了你的戀人。", 3)],
                        "complete": True,
                    },
                },
            ],
        },
    ],
    "rewards": [money(300), {"type": "xp", "amount": 1800}],
}

BATCH = [dawn1, dawn2, dawn3, whisper1, whisper2, whisper3, lil1, lil2, lil3]

# ---------------- 輸出 ----------------

def j(v):
    return json.dumps(v, ensure_ascii=False)


def inline(v):
    if isinstance(v, dict):
        return '{ ' + ', '.join(f'{j(k)}: {inline(x)}' for k, x in v.items()) + ' }' if v else '{}'
    if isinstance(v, list):
        return '[' + ', '.join(inline(x) for x in v) + ']'
    return j(v)


def fmt(v, ind=0, width=120):
    one = inline(v)
    if not isinstance(v, (dict, list)) or len(one) + ind <= width and not (isinstance(v, dict) and 'text' in v and len(one) > 60):
        return one
    pad = ' ' * (ind + 2)
    if isinstance(v, list):
        return '[\n' + ',\n'.join(pad + fmt(x, ind + 2, width) for x in v) + '\n' + ' ' * ind + ']'
    return '{\n' + ',\n'.join(f'{pad}{j(k)}: {fmt(x, ind + 2, width)}' for k, x in v.items()) + '\n' + ' ' * ind + '}'


import subprocess
from story_batch2 import BATCH2
from story_batch3 import BATCH3
from story_batch4 import BATCH4
from story_batch5 import BATCH5
from story_batch6 import BATCH6
from story_batch7 import BATCH7
from story_batch8 import BATCH8
from story_batch9 import BATCH9
from story_batch10 import BATCH10
from story_batch11 import BATCH11
from story_batch12 import BATCH12
from story_batch13 import BATCH13
from story_batch14 import BATCH14
from story_batch15 import BATCH15
from story_batch16 import BATCH16
from story_batch17 import BATCH17
from story_batch18 import BATCH18
from story_batch19 import BATCH19
from story_batch20 import BATCH20
from story_batch21 import BATCH21
from story_batch22 import BATCH22
from story_batch23 import BATCH23
from story_batch24 import BATCH24
from story_batch25 import BATCH25
from story_batch26 import BATCH26
from story_batch27 import BATCH27
from story_batch28 import BATCH28
from story_batch29 import BATCH29
from story_batch30 import BATCH30
from story_batch31 import BATCH31
BATCH = BATCH + BATCH2 + BATCH3 + BATCH4 + BATCH5 + BATCH6 + BATCH7 + BATCH8 + BATCH9 + BATCH10 + BATCH11 + BATCH12 + BATCH13 + BATCH14 + BATCH15 + BATCH16 + BATCH17 + BATCH18 + BATCH19 + BATCH20 + BATCH21 + BATCH22 + BATCH23 + BATCH24 + BATCH25 + BATCH26 + BATCH27 + BATCH28 + BATCH29 + BATCH30 + BATCH31
# 史詩大場面：頭目戰搬進專屬的特殊地圖（epic_places.py）
from epic_places import place_epics
place_epics(BATCH)
# 任務的獨特裝備（uniq23.py）：Lv.5～11 的完成獎勵、政治史詩的論功行賞、巨龍投影的掉落
from uniq23 import place_gear
place_gear(BATCH)
# 成人向角色線的親密場景（adult_scenes26.py）：戀人結局、非成人向角色線的「四」、寄生物的儀式
from story_batch26 import apply_dress
print('dressed quests', apply_dress(BATCH))

from adult_scenes26 import place_scenes
print('scenes', place_scenes(BATCH, BATCH23))

# 打工線的獨特色情技能（lust_skills_s6.py）：結局拿到獨特色情裝備的地方，接著學會那條線的技能
from lust_skills_s6 import place_skills
print('lust skills', place_skills(BATCH))

# 魅魔的遊樂園的集章任務（lust_park_s7.py）
from lust_park_s7 import PARK_STORIES
BATCH = BATCH + PARK_STORIES

# 地下城線的底層層主戰可以重試：不寫失敗的結果，輸了任務點保持開放（Lv.11 打 13 級的層主多半會輸，讓玩家練等之後再來）
_enemy_data = json.load(open('data/rules/enemies.json'))
ABYSS_BOSSES = {g[0] for t in _enemy_data['encounters'].values() for g in (t.get('bosses') or {}).get('abyss', []) if _enemy_data['enemies'] and any(e['id'] == g[0] and e['level'] >= 13 for e in _enemy_data['enemies'])}
RETRY_NODES = []
_names = {e['id']: e['name'] for e in _enemy_data['enemies']}


def retry_fail(node):
    foe = _names[node['enemies'][0][0]]
    return {"text": f"你們撐不住，只能先退了下來。{foe}還在那裡——等你們準備好了，可以再來挑戰。", "retry": True}

for _s in BATCH:
    for _n in _s['nodes']:
        if _n.get('kind') == 'combat' and any(m in ABYSS_BOSSES for m, _ in _n.get('enemies', [])):
            _n['fail'] = retry_fail(_n)
            RETRY_NODES.append((_s['id'], _n['id']))
# 試煉類的戰鬥也可以重試（練好了再來，而不是輸了也算過關）
RETRY_EXTRA = {('trial_new_moon', 'lizards'), ('trial_bloodhorn_warrior', 'beasts'), ('trial_war_spirits', 'spirits'), ('law_bone_throne', 'axes')}
for _s in BATCH:
    for _n in _s['nodes']:
        if (_s['id'], _n['id']) in RETRY_EXTRA:
            assert 'fail' in _n, (_s['id'], _n['id'])
            _n['fail'] = retry_fail(_n)
            RETRY_NODES.append((_s['id'], _n['id']))
base = subprocess.run(['git', 'show', '2fa8ee9:data/rules/stories.json'], cwd='.', capture_output=True, text=True, check=True).stdout
orig = json.loads(base)['stories']
assert not {s['id'] for s in orig} & {s['id'] for s in BATCH}
assert len({s['id'] for s in BATCH}) == len(BATCH)
tail = base.rstrip()
body = tail[:tail.rindex(']')].rstrip()
out = body + ',\n' + ',\n'.join('    ' + fmt(s, 4) for s in BATCH) + '\n  ]\n}\n'
assert json.loads(out)['stories'] == orig + BATCH
open(P, 'w').write(out)
print('stories', len(orig + BATCH), 'retry', RETRY_NODES)
