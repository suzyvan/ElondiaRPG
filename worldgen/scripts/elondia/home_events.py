"""家裡的事（R31 H6，docs/HOMES.md 第 8.1 節）：家僕（或做家務的奴隸）在自己房子裡的事件，寫進 data/rules/travel_events.json（scope: home）。
可以重跑：先拿掉這幾個 id 的模板再加回去。
- 文字的 {a} 是挑到的那位家僕，效果的 $a 是他的 id（親密度、請假、工錢、慾望指標）
- 一般的 6 件、成人向的 4 件（只標「成人向」：對象是家僕，性別不固定，不標對象的內容標籤；都是主角自己選的，不標「主角非自願」）
- 家裡的事都是選擇的事件；檢定寫的是實際的 DC
"""
import json

R = ''


def cond(c, target='pc'):
    return {"type": "condition", "target": target, "condition": c, "add": True}


def aff(d):
    return {"type": "affinity", "npc": "$a", "delta": d}


def wage(days):
    return {"type": "staff_wage", "npc": "$a", "days": days}


def pause(days):
    return {"type": "staff_pause", "npc": "$a", "days": days}


def lewd(stat, d, target='$a'):
    return {"type": "lewd", "stat": stat, "delta": d, "target": target}


def item(name, qty=1):
    return {"type": "item", "name": name, "qty": qty}


def money(n):
    return {"type": "money", "amount": n}


STOW = {"type": "stow_decor"}


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


def ev(i, title, category, text, options, staff=None, bond=None, affinity=None, moments=None, hours=None, tags=None, scene=None, cooldown=None):
    e = {"id": i, "scope": "home", "tier": "normal", "kind": "choice", "category": category}
    if staff: e["staff"] = staff
    if bond: e["staff_bond"] = bond
    if affinity: e["staff_affinity"] = affinity
    if moments: e["moments"] = moments
    if hours: e["hours"] = hours
    if cooldown: e["cooldown_days"] = cooldown
    if tags: e["tags"] = tags
    e["title"] = title
    e["text"] = text
    if scene: e["scene"] = scene
    e["options"] = options
    return e


ADULT = ['adult']

E = [
    # ---- 一般的 6 件 ----
    ev('hm_slacking', '偷懶被抓到', 'trouble',
       '你推開儲藏室的門，{a}正靠在麻袋堆上打盹，手裡還捏著抹布。聽到開門聲，{a}整個人彈了起來，臉一下子漲紅了。',
       [opt('罵一頓', out('你把{a}數落了一頓。{a}低著頭連聲說不會再有下次，之後幹活勤快了不少，只是看你的眼神有點委屈。', aff(-2))),
        opt('放一馬', out('你擺擺手，說累了就去好好睡一覺，別在儲藏室打盹。{a}愣了一下，紅著眼眶道了謝。', aff(2))),
        opt('扣一天工錢', out('你說今天這一天就不算工錢了。{a}咬著嘴唇點點頭，沒有再說什麼。', wage(-1), aff(-5)))],
       bond='hired', moments=['step']),
    ev('hm_vase', '打破了花瓶', 'trouble',
       '一聲脆響，接著是好長一段安靜。你循聲走過去，{a}跪在地上撿著碎片，旁邊的擺設歪了一大片，連帶著把一件擺飾撞倒了。「對、對不起！我馬上收好！」',
       [opt('沒關係，人沒事就好', out('你叫{a}先別用手撿，小心割傷。{a}把碎片掃乾淨，那件被撞倒的擺飾先收了起來，等你有空再擺回去。', STOW, aff(2))),
        opt('從工錢裡扣', out('你說花瓶的錢從工錢裡扣。{a}默默收拾好碎片，那件被撞倒的擺飾也先收了起來。', STOW, wage(-1), aff(-3)))],
       staff=['maid'], bond='hired', moments=['step']),
    ev('hm_letter', '家鄉來的信', 'social',
       '{a}手裡攥著一封皺巴巴的信，在門口站了好一會兒才敲門。「家裡來信，說母親病了……能不能讓我回去幾天？」',
       [opt('准假，快回去吧', out('你讓{a}放心回去，家裡的事你自己會照顧。{a}深深鞠了一躬，當天就收拾行李出發了。', pause(3), aff(5))),
        opt('現在走不開', out('你說家裡現在少不了人，等過一陣子再說。{a}低聲說了句「我知道了」，轉身回去幹活，背影有點僵。', aff(-3)))],
       bond='hired', moments=['step']),
    ev('hm_new_dish', '試做的新菜', 'opportunity',
       '{a}端著一個小碟子從廚房探出頭來，碟子上是一團看不太出是什麼的東西，冒著奇怪的香氣。「我照南方的做法試了一道新菜，您要不要嘗嘗看？」',
       [opt('嘗嘗看，順便給點意見', out('意外地好吃。你說了幾個想法，{a}眼睛一亮，又回廚房改了一次，端出來的那盤讓你吃得心滿意足。', cond('fed_fine'), aff(2)),
            out('你咬了一口，臉就皺成一團。{a}看你的表情，自己也嘗了一口，兩個人對著碟子笑出聲來。「我再試試……」', aff(1)),
            check=('int', 11)),
        opt('下次吧', out('你說現在不餓。{a}有點失望地把碟子端回去了。', aff(-1)))],
       staff=['cook'], moments=['step']),
    ev('hm_garden_find', '院子裡的怪東西', 'omen',
       '{a}在苗圃邊挖土的時候，鏟子「鏗」地撞到了什麼硬東西。{a}把它刨出來擦了擦，拿過來給你看：一塊沾滿泥巴、隱隱發著涼意的東西。',
       [opt('仔細看看是什麼', out('你把泥巴洗乾淨，是一塊會回聲的石頭，敲一下，屋裡好幾個地方都響了一聲。這種石頭工匠拿來當材料。', item('回音殘響石')),
            out('洗乾淨一看，只是一塊普通的石頭，大概是以前蓋房子時留下來的。', aff(1)),
            check=('int', 12)),
        opt('讓園丁自己處理', out('你說交給{a}處理就好。{a}把它擺在院子的角落，說看起來挺好看的。', aff(1)))],
       staff=['gardener'], moments=['step']),
    ev('hm_ledger', '管家的帳本', 'trouble',
       '{a}捧著帳本來找你，眉頭皺得很緊。「這個月的帳對不上，少了一筆。我查了兩遍，還是不知道錢跑到哪裡去了。」',
       [opt('一起查帳', out('你和{a}對著帳本一筆一筆對，終於找到了：是上個月有一筆貨款付了兩次。{a}去要了回來，順便換了一家比較老實的商人。', money(80), aff(2)),
            out('你們對到半夜還是對不出來。{a}嘆了口氣，說就當作是學個教訓。'),
            check=('int', 13)),
        opt('算了，下次小心', out('你說這點錢不必計較，以後記得仔細點。{a}鬆了一口氣，說以後每一筆都會請你過目。', aff(2)))],
       staff=['steward'], moments=['step']),
    # ---- 成人向的 4 件 ----
    ev('hm_night_visit', '夜裡的侍寢', 'social',
       '夜深了，房門被輕輕敲了兩下。{a}站在門外，只披著一件薄薄的睡袍，燭光下臉頰紅得發燙。「我……睡不著。可以讓我待在這裡嗎？」',
       [opt('讓{a}進來', out('你讓{a}進了房間。那一夜，{a}留下來陪你到天亮。', cond('afterglow'), aff(5)), scene='always'),
        opt('溫柔地婉拒', out('你說今晚想一個人好好休息。{a}點點頭，說了聲晚安，輕輕帶上了門。')),
        opt('叫{a}回去睡', out('你板起臉叫{a}回去睡覺。門外安靜了好一會兒，才傳來慢慢走遠的腳步聲。', aff(-3)))],
       affinity=[40, 100], moments=['rest'], hours='night', tags=ADULT, cooldown=10,
       scene='家僕{a}深夜來到主角的房間，在主角的床上主動獻上身體，兩人纏綿到天亮'),
    ev('hm_bath', '服侍沐浴', 'social',
       '你正泡在澡盆裡，門口傳來{a}的聲音：「水溫還可以嗎？我幫您擦背。」沒等你回答，{a}就挽起袖子走了進來，手裡拿著毛巾和香油。',
       [opt('讓{a}服侍', out('你閉上眼睛，讓{a}的手沿著你的背慢慢往下。毛巾很快就被丟到一邊，洗澡水換了兩次才洗完。', cond('afterglow'), aff(3)), scene='always'),
        opt('自己來就好', out('你接過毛巾，說你自己洗就可以了。{a}有點不好意思地退了出去。'))],
       staff=['maid'], moments=['step'], tags=ADULT, cooldown=8,
       scene='女僕{a}在浴室裡替入浴的主角擦背，抹著香油的手越摸越大膽，最後兩人在澡盆裡做了起來'),
    ev('hm_peeping', '偷看', 'omen',
       '你換衣服換到一半，眼角瞥見門縫外有個影子。是{a}——一動也不動地看著你，連呼吸都忘了。',
       [opt('裝作沒看見', out('你若無其事地換好衣服。門縫外的影子什麼時候走的，你也沒注意。')),
        opt('叫住{a}', out('你叫了一聲{a}的名字。門外傳來一陣慌亂的腳步聲，晚飯時{a}紅著臉，一句話也不敢說。', aff(-2))),
        opt('讓{a}看個夠', out('你乾脆把門推開，慢慢地把剩下的衣服脫掉。{a}站在門口，看得目不轉睛。', cond('aroused'), aff(3)), scene='always')],
       moments=['step'], tags=ADULT, cooldown=8,
       scene='主角發現家僕{a}在門縫偷看自己換衣服，乾脆推開門，在{a}面前一件一件慢慢脫光，讓{a}看個夠'),
    ev('hm_command', '主人的命令', 'social',
       '{a}跪在地上擦著地板，聽到你的腳步聲就停下手，抬起頭等你吩咐。項圈上的環輕輕晃著。',
       [opt('命令{a}放下抹布來服侍你', out('你說地板等一下再擦。{a}順從地爬到你腳邊，照你的吩咐服侍你，一句怨言也沒有。', lewd('submission', 2), cond('afterglow')), scene='always'),
        opt('讓{a}繼續做家務', out('你點點頭，讓{a}繼續擦地。{a}低下頭，擦得更賣力了。', lewd('submission', 1)))],
       bond='slave', moments=['step'], tags=ADULT, cooldown=6,
       scene='主角命令在家裡做家務的奴隸{a}放下抹布，跪在地上服侍主角'),
]
IDS = {e['id'] for e in E}

if __name__ == '__main__':
    assert len(IDS) == len(E)
    for e in E:
        assert len(e['title']) <= 20 and len(e['text']) <= 400 and len(e.get('scene', '')) <= 200, e['id']
        for o in e['options']: assert len(o['label']) <= 30, o['label']
    P = R + 'data/rules/travel_events.json'
    s = open(P).read()
    lines = [l for l in s.split('\n') if not any(l.startswith(f'    {{"id": "{i}"') for i in IDS)]
    s = '\n'.join(lines)
    # 模板陣列的結尾：最後一個模板後面接上這幾個事件
    end = s.index('\n  ],\n  "town": {')
    head = s[:end].rstrip().rstrip(',')
    new = ',\n'.join('    ' + json.dumps(e, ensure_ascii=False) for e in E)
    s = head + ',\n' + new + s[end:]
    data = json.loads(s)
    assert sum(1 for t in data['templates'] if t['id'] in IDS) == len(E)
    open(P, 'w').write(s)
    print('home events', len(E))
