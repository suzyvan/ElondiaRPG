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
        for c in groups['物品圖鑑']:
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
            open(os.path.join(d, e['id'] + '.webp'), 'wb').write(shrink(c['data']))
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
