"""成人向打工線的重複打工（地標的場景）改成「穿著制服的人上工」：主角或隊友都可以。

打工線結束之後，地標上有兩個可以重複的打工場景（銀鱗旅店的晚班、溫泉旅館的幫工……，共 23 個）。原本寫的是場景的
wear（主角要穿著制服）與 pc_body（主角的體型），只有主角能上工。這支腳本照主題體驗區的做法（park_experience48.py）
把它們改成場景的身分（role）：隊伍裡穿著那套制服的人去上工（主角或隊友；都穿了就一起），

- role.name「幫工」、role.wear 是原本的制服、role.body 是原本限定的體型（看上工的人自己的體型）
- 場景文字裡的「主角」換成 {role}（上工的人的名字；主角寫「主角」）
- 原本給主角的非戰鬥狀態（興奮、虛脫、衣衫不整……）移到 role.effects，給上工的每個人；工錢照舊在場景上（一份）

只改下面 SCENES 列的場景（地標 id、場景名稱）；已經改過的（有 role、沒有 wear）照樣算對，可以重跑。
要排在建立這些地標的腳本（work26.py、east_p9_work.py）之後。
"""

import json

PATH = 'data/world/landmarks.json'
ROLE_NAME = '幫工'

# 打工線結束之後可以重複的打工（地標 id → 場景名稱）
SCENES = {
    'lm_silverscale_inn': ['上晚班', '包場的夜'],
    'lm_tent_ring_bazaar': ['市集的舞', '帳篷裡的加場'],
    'lm_golden_dice': ['發牌的夜班', '貴賓室的轉運'],
    'lm_krause_manor': ['見習女僕的一天', '父子的晚上'],
    'lm_pilgrim_bath': ['再走一次朝聖大道'],
    'lm_pearl_bath': ['搓背的班', '深池的常客'],
    'lm_ironforge_onsen': ['混浴的幫工', '礦工的發薪夜'],
    'lm_lower_massage': ['特別服務', '三人套餐'],
    'lm_bed_school': ['見習館的夜課', '宮廷的晚宴'],
    'lm_yh_scholar_inn': ['秋闈的夜課', '謝恩的包場'],
    'lm_yh_pleasure_boat': ['搖一趟櫓', '包船的夜'],
    'lm_yh_pearl_dock': ['冬天的珠船', '船艙的取暖'],
}


def personal(e):
    """給主角的非戰鬥狀態：改成給上工的人（對象由身分換成那個人）"""
    return e.get('type') == 'condition' and e.get('target', 'pc') == 'pc'


def convert(sc):
    if sc.get('role') and not sc.get('wear'):
        return False
    wear = sc.pop('wear')
    role = {'name': ROLE_NAME, 'wear': wear}
    body = sc.pop('pc_body', None)
    if body:
        role['body'] = body
    effects = sc.get('effects', [])
    # 對象照舊寫主角：身分的效果會把對象換成上工的那個人
    moved = [e for e in effects if personal(e)]
    kept = [e for e in effects if not personal(e)]
    if moved:
        role['effects'] = moved
    if kept:
        sc['effects'] = kept
    else:
        sc.pop('effects', None)
    sc['scene'] = sc['scene'].replace('主角', '{role}')
    sc['role'] = role
    return True


def main():
    d = json.load(open(PATH, encoding='utf-8'))
    by_id = {l['id']: l for l in d['landmarks']}
    changed = 0
    for lid, titles in SCENES.items():
        l = by_id[lid]
        for title in titles:
            sc = next((s for s in l.get('scenes', []) if s['title'] == title), None)
            assert sc, f'{lid} 沒有場景「{title}」'
            assert sc.get('wear') or sc.get('role'), f'{lid}／{title} 沒有制服也沒有身分'
            changed += convert(sc)
    open(PATH, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=1))
    print(f'改了 {changed} 個打工場景')


if __name__ == '__main__':
    main()
