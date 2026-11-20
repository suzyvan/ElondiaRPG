"""把玩家整理的圖鑑 HTML（物品圖鑑、怪物圖鑑、角色圖鑑）匯成遊戲內建的圖。可以重跑：同一張圖會覆蓋。

用法：python3 -I tools/icons/import_icons.py <圖鑑.html> [<圖鑑.html> ...]
（-I：圖鑑是外部檔案，只當文字解析，不執行裡面的東西）

圖鑑的格式：每一張是 <article class="card" data-n="名稱"><img src="data:image/...;base64,...">，
「埃隆迪亞大陸・角色圖鑑」另有 <span class="id">npc id</span>。依 <title> 分類：

- 物品圖鑑 → public/icons/items/<名稱的雜湊>.webp（縮到 128 像素），對照表 src/assets/icons/itemIcons.json（名稱 → 檔名）。
  名稱用雜湊當檔名：物品名稱有中文與各種符號，有些系統不能當檔名。遊戲裡沒有的物品略過。
- 怪物圖鑑 → public/icons/monsters/<怪物 id>.webp（縮到 128 像素），有圖的怪物列在 src/assets/icons/monsterIcons.json。
  物品與怪物的圖放 public/（照原樣複製、用網址載入）：放進 src/ 讓 Vite 打包的話，小於 4 KB 的圖會被內嵌進 JS，主程式會大好幾 MB。圖鑑的順序是怪物依等級排序（同等級照 enemies.json 的順序），
  依這個順序對上 id（有同名、不同等級的怪物）；名稱對不上時停下來，不亂配。
- 角色圖鑑（只有名稱）→ src/assets/portraits/<npc id>.webp，照原檔（512 寬），取代原本的內建形象圖。
  同時有帶 id 的「埃隆迪亞大陸・角色圖鑑」時，那一份的圖比較小（360 寬的 JPEG），只用來確認名稱與 id，不拿它的圖。

需要 Pillow。說明見 docs/ITEMS.md 第 8 節、docs/MONSTERS.md、docs/PORTRAITS.md。
"""

import base64
import hashlib
import io
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ICON_PX = 128
QUALITY = 82


def cards(path):
    s = open(path, encoding='utf-8').read()
    title = re.search(r'<title>([^<]*)</title>', s).group(1).strip()
    out = []
    for attrs, body in re.findall(r'<article class="card"([^>]*)>(.*?)</article>', s, re.S):
        m = re.search(r'src="data:image/([a-z]+);base64,([A-Za-z0-9+/=]+)"', body)
        if not m:
            continue
        name = re.search(r'data-n="([^"]*)"', attrs) or re.search(r'<h3>([^<]*)', body)
        nid = re.search(r'<span class="id">([^<]*)</span>', body)
        out.append({'name': name.group(1).strip() if name else '', 'id': nid.group(1) if nid else None, 'data': base64.b64decode(m.group(2))})
    return title, out


def shrink(data, px=ICON_PX):
    im = Image.open(io.BytesIO(data)).convert('RGB')
    if max(im.size) > px:
        w, h = im.size
        im = im.resize((px, round(px * h / w)) if w >= h else (round(px * w / h), px), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'WEBP', quality=QUALITY, method=6)
    return b.getvalue()


# 原圖拼接錯位的修正（2026-11-20 玩家提供的圖鑑）：幾張圖是從一整排的圖切出來的，切的位置偏了，
# 一張圖裡有兩件東西、中間一條直線（物品圖鑑的絲絨頸環到鍊金師的皮帽，連續 7 張），或邊上帶到隔壁那張的一條（幾隻怪物）。
# 物品的那一排是連續的：一件東西被切成兩半、分在相鄰兩張裡，照順序把兩段接回來就是完整的圖。
# 座標是原圖（256×256）的範圍 [x0, x1)；玩家給了修好的圖鑑時，把對應的項目拿掉。
# 物品：名稱 → 依序接起來的幾段（取哪一張圖, x0, x1）
ITEM_FIX = {
    '絲絨頸環': [('絲絨頸環', 222, 256), ('盜賊公會的舊手套', 0, 175)],
    '盜賊公會的舊手套': [('盜賊公會的舊手套', 177, 256), ('老獵人的護身符', 0, 128)],
    '老獵人的護身符': [('老獵人的護身符', 130, 256), ('說書人的銀耳環', 0, 91)],
    '說書人的銀耳環': [('說書人的銀耳環', 93, 256)],
    '走私客的腳鍊': [('走私客的腳鍊', 0, 220)],
    '修女的念珠': [('走私客的腳鍊', 222, 256), ('修女的念珠', 0, 179)],
    '鍊金師的皮帽': [('修女的念珠', 181, 256), ('鍊金師的皮帽', 0, 245)],
}
# 怪物：id → （x0, x1），切掉右邊帶到的那一條
MONSTER_TRIM = {
    'lp_lewd_slug': (0, 230), 'lp_boss_white_fox': (0, 230), 'lp_rut_boar': (0, 229),
    'lp_lewd_fox': (0, 246), 'lp_boss_hound_alpha': (0, 246), 'lp_aphro_leech': (0, 246),
    'pp_scale_wing': (0, 247), 'pp_boss_succubus_mother': (0, 247), 'livia_projection': (0, 248),
    'prototype_golem': (0, 250), 'nameless_khan_army': (0, 250), 'guaizi_horse_ghost': (0, 250), 'broken_arrow_ghost': (0, 250),
}


def panel(parts):
    """把幾段 (原圖, x0, x1) 依序接起來再補成正方形：夠寬的上下各切掉一點，太窄的左右補上背景色（邊上像素的中位數）"""
    ims = [Image.open(io.BytesIO(d)).convert('RGB') for d, _, _ in parts]
    h = ims[0].height
    crops = [im.crop((x0, 0, min(x1, im.width), h)) for im, (_, x0, x1) in zip(ims, parts)]
    part = Image.new('RGB', (sum(c.width for c in crops), h))
    x = 0
    for c in crops:
        part.paste(c, (x, 0))
        x += c.width
    pw = part.width
    if pw >= h * 0.8:
        top = (h - pw) // 2
        out = part.crop((0, top, pw, top + pw))
    else:
        edge = [part.getpixel((x, y)) for x in (0, pw - 1) for y in range(h)] + [part.getpixel((x, y)) for y in (0, h - 1) for x in range(pw)]
        fill = tuple(sorted(c[i] for c in edge)[len(edge) // 2] for i in range(3))
        out = Image.new('RGB', (h, h), fill)
        out.paste(part, ((h - pw) // 2, 0))
    b = io.BytesIO()
    out.save(b, 'PNG')
    return b.getvalue()


def item_file(name):
    return hashlib.sha1(name.encode('utf-8')).hexdigest()[:12]


def main(paths):
    items = {i['name'] for i in json.load(open(os.path.join(ROOT, 'data/rules/items.json'), encoding='utf-8'))['items']}
    enemies = json.load(open(os.path.join(ROOT, 'data/rules/enemies.json'), encoding='utf-8'))
    enemies = enemies['enemies'] if isinstance(enemies, dict) and 'enemies' in enemies else enemies
    enemies = enemies if isinstance(enemies, list) else list(enemies.values())
    npcs = json.load(open(os.path.join(ROOT, 'data/world/npcs.json'), encoding='utf-8'))
    npcs = npcs['npcs'] if isinstance(npcs, dict) else npcs
    npc_by_name = {}
    for n in npcs:
        npc_by_name.setdefault(n['name'], []).append(n['id'])

    groups = {}
    for p in paths:
        title, cs = cards(p)
        groups.setdefault(title, []).extend(cs)

    # 物品
    if '物品圖鑑' in groups:
        d = os.path.join(ROOT, 'public/icons/items')
        os.makedirs(d, exist_ok=True)
        os.makedirs(os.path.join(ROOT, 'src/assets/icons'), exist_ok=True)
        idx_path = os.path.join(ROOT, 'src/assets/icons/itemIcons.json')
        index = json.load(open(idx_path, encoding='utf-8')) if os.path.exists(idx_path) else {}
        skipped = []
        by_name = {c['name']: c['data'] for c in groups['物品圖鑑']}
        for c in groups['物品圖鑑']:
            fix = ITEM_FIX.get(c['name'])
            if fix and all(src in by_name for src, _, _ in fix):
                c = {**c, 'data': panel([(by_name[src], x0, x1) for src, x0, x1 in fix])}
            if c['name'] not in items:
                skipped.append(c['name'])
                continue
            f = item_file(c['name'])
            open(os.path.join(d, f + '.webp'), 'wb').write(shrink(c['data']))
            index[c['name']] = f
        json.dump(dict(sorted(index.items())), open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        print(f'物品：{len(groups["物品圖鑑"]) - len(skipped)} 張；遊戲裡沒有、略過 {len(skipped)} 張：{"、".join(skipped)}')
        missing = sorted(items - set(index))
        if missing:
            print(f'  遊戲裡還沒有圖的物品 {len(missing)} 件：{"、".join(missing[:20])}{"……" if len(missing) > 20 else ""}')

    # 怪物：圖鑑照等級排序（穩定排序），依序對上 id
    if '怪物圖鑑' in groups:
        cs = groups['怪物圖鑑']
        order = sorted(enemies, key=lambda e: e.get('level', 0))
        if len(cs) != len(order) or any(c['name'] != e['name'] for c, e in zip(cs, order)):
            sys.exit('怪物圖鑑的名稱順序和 enemies.json 依等級排序的結果對不上：怪物有增減時，請拿新的圖鑑或改成依名稱對')
        d = os.path.join(ROOT, 'public/icons/monsters')
        os.makedirs(d, exist_ok=True)
        list_path = os.path.join(ROOT, 'src/assets/icons/monsterIcons.json')
        os.makedirs(os.path.dirname(list_path), exist_ok=True)
        have = set(json.load(open(list_path, encoding='utf-8'))) if os.path.exists(list_path) else set()
        for c, e in zip(cs, order):
            trim = MONSTER_TRIM.get(e['id'])
            data = panel([(c['data'], *trim)]) if trim else c['data']
            open(os.path.join(d, e['id'] + '.webp'), 'wb').write(shrink(data))
            have.add(e['id'])
        json.dump(sorted(have), open(list_path, 'w', encoding='utf-8'), indent=0)
        print(f'怪物：{len(cs)} 張')

    # 角色：只有名稱的那一份，依名稱對上 npc id（帶 id 的那一份只用來確認）
    if '角色圖鑑' in groups:
        info = {c['name']: c['id'] for c in groups.get('埃隆迪亞大陸・角色圖鑑', [])}
        d = os.path.join(ROOT, 'src/assets/portraits')
        n = 0
        for c in groups['角色圖鑑']:
            ids = npc_by_name.get(c['name'], [])
            if len(ids) != 1:
                print(f'  角色「{c["name"]}」對不上唯一的 npc（{ids}），略過')
                continue
            if c['name'] in info and info[c['name']] != ids[0]:
                sys.exit(f'角色「{c["name"]}」的 id 兩份圖鑑不一致：{info[c["name"]]} / {ids[0]}')
            Image.open(io.BytesIO(c['data'])).verify()
            open(os.path.join(d, ids[0] + '.webp'), 'wb').write(c['data'])
            n += 1
        print(f'角色：{n} 張（取代或新增內建形象圖）')


if __name__ == '__main__':
    main(sys.argv[1:])
