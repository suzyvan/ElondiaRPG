"""勢力聲望的補強：河谷鎮（人類諸國聯盟）、大燁朝廷與媞丹汗國的特殊任務結局給的聲望。

這三個勢力的任務很多，但結局幾乎不給自己的聲望（全部跑完，聯盟只拿得到十幾點、大燁 27 點、媞丹 29 點；
聲望 10 才是最好的一級，地標要 10～30）。這支腳本把下面兩張表列的結局（故事 id、節點 id、選項的文字、success 或 fail）
的聲望設成表上的數字（下面三張表；同一個勢力原本的聲望換掉；表上是 0 的拿掉）。列的都是結局（complete），
可以重跑；改數字時改表再重跑。

- RIVERVALE：河谷鎮的任務，逐條訂的。入門與一般任務 +1～3，各條線的結局 +3～5，戰爭與史詩的結局 +5；
  偶像線與打工線（成人向）D、C 級 +1、B 級 +2。站在對方那邊的選擇（把魔族使者交給教廷、交給赤翼管理……）不給。
  修女的懺悔（教廷的事）、史詩的指引（只是指路）不給。
- YANYE：大燁的任務，依規則產生、再看過一遍：地區線依任務等級 E/D +1、C +2、B +3、A +4、S +5；
  角色線、成人向的打工與祭典線減半（C +1、B +2）。失敗結局少 2。已經寫了聲望的結局不動
  （偏金墨盟、或扣大燁聲望的選擇照舊）；同一個任務裡另一個結局已經給大燁聲望時，折衷的結局給一半。
  萬民書：親政 +5、立憲 +3、退位不給。
- TIDAN：媞丹的任務，規則和 YANYE 一樣（地區線是 tdn、tdr、tdl、tds、tdt、tdh、tdm、tdw、tdu、tdx、tdpol、nspol 開頭的）。
  政治線的分歧點（那達慕之約、兩國的夜議）只給 +2，因為各自的結局任務本來就給聲望；
  削弱汗國的走向（海東青飛走了、海上之盟）、把馬送給海東部、讓貢隊回冬營不給；大法典的「各部自治、減輕貢賦」+1；
  榷場的火、歲幣的使節（兩國之間的事）+3。
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from east_story_io import write_stories  # noqa: E402

PATH = 'data/rules/stories.json'

# 故事 id → [(節點 id, 選項文字（節點本身的結局寫 ''）, 'success' 或 'fail', 聲望)]
RIVERVALE = {
    'overturned_wagon': [('hideout', '', 'success', 2), ('home', '', 'success', 2)],  # 翻覆的篷車
    'rivervale_oath_stone': [('report', '把審判廷的密令公開', 'success', 3), ('report', '說是魔族的奸細幹的', 'success', 1)],  # 舊石橋的誓約石
    'rivervale_cellar': [('cellar', '讓會談在地下室進行', 'success', 4)],  # 銀鱗旅店的地下室
    'spirit_river_girl': [('vow', '立誓會再回來看她', 'success', 2), ('vow', '立誓會查出誓約被打破的原因', 'success', 2)],  # 河面上的少女
    'spirit_upstream': [('drain', '炸掉工坊的排水溝', 'success', 2), ('drain', '把帳冊交給兩國的使節', 'success', 4)],  # 上游的濁流
    'spirit_drowned': [('blessing', '接受她的祝福', 'success', 2), ('blessing', '請她繼續守護這座橋', 'success', 5)],  # 河底的怨靈
    'lena_runaway': [('back', '', 'success', 1)],  # 逃到河谷鎮的人
    'pil_old_bridge': [('vow', '「我會作證到最後」', 'success', 2), ('vow', '「讓她在審判前滴酒不沾」', 'success', 2)],  # 舊石橋的誓言
    # 政治與史詩
    'pol_storm_eve': [('side', '站在人類這一邊', 'success', 5), ('purge', '「從萊茵堡開始」', 'success', 3)],  # 風暴的前夜
    'pol_war_h_rivervale': [('after', '「按戰爭的規矩，善待俘虜」', 'success', 5), ('after', '「交給帝國處置」', 'success', 2)],  # 河谷鎮的前線
    'pol_war_d_rivervale': [('after', '「河谷鎮是冒險者的鎮。讓它保持中立」', 'success', 5)],  # 河谷鎮的十字路口
    'pol_acheron_gaze': [('spoils', '抓住書籤', 'success', 3), ('spoils', '抓住指環', 'success', 3), ('spoils', '抓住耳墜', 'success', 3)],  # 阿契隆的注視
    'drg_acheron': [('end', '*', 'success', 5)],  # 回響的盡頭（兩個結局都給）
    # 偶像線（成人向）
    'stella_lost_idol': [('after', '*', 'success', 1)],
    'stella_empty_seats': [('rain', '*', 'success', 1)],
    'stella_star_confession': [('confess', '*', 'success', 2)],
    'noir_blank_score': [('listen', '*', 'success', 1)],
    'noir_fan_letters': [('night', '*', 'success', 1)],
    'noir_song_for_whom': [('song', '*', 'success', 2)],
    'pom_unpaid_fee': [('share', '*', 'success', 1)],
    'pom_theater_contract': [('deal', '*', 'success', 1)],
    'pom_guard_contract': [('sign', '*', 'success', 2)],
    'group_idol_backstage': [('backstage', '*', 'success', 2)],
    # 銀鱗旅店的打工線（成人向）
    'inn_skirt': [('regular', '*', 'success', 1)],
    'inn_table': [('more', '*', 'success', 1)],
    'inn_feast': [('prize', '*', 'success', 2)],
}

YANYE = {
    'yh_banned_manuscript': [  # 被搜走的稿子
        ('return', '', 'success', 1),
    ],
    'yh_storyteller': [  # 瓦舍的說書人
        ('captive', '交給蕭鳳儀處置', 'success', 1),
        ('captive', '放他走，換他盯著管家', 'success', 1),
    ],
    'yh_night_market': [  # 御街的夜市
        ('report', '勸她先別聲張', 'success', 1),
    ],
    'yh_xiaozhu_sea': [  # 小柱想去看海
        ('sea', '鼓勵他留下來當水手', 'success', 1),
        ('sea', '看完就帶他回龍安府', 'success', 1),
    ],
    'yh_dadan_luck': [  # 黃大膽的霉運
        ('report', '', 'success', 1),
    ],
    'yh_apao_firecracker': [  # 阿炮的爆竹
        ('test', '', 'success', 1),
    ],
    'yhl_ancestor_rite': [  # 祖龍的祭文
        ('report', '', 'success', 1),
    ],
    'yhl_glazed_scale': [  # 點出來的青
        ('truth', '請他先收著', 'success', 2),
    ],
    'yhh_lost_tongue': [  # 不會說狐語的孩子
        ('back', '', 'success', 1),
    ],
    'yhh_spirit_roster': [  # 仙家的名冊
        ('roster', '', 'success', 2),
    ],
    'yhh_nine_tails': [  # 九尾的傳說
        ('elm', '只供在仙堂', 'success', 3),
    ],
    'yhk_exam_marks': [  # 考卷的暗記
        ('report', '', 'success', 1),
    ],
    'yhk_results_night': [  # 放榜之夜
        ('hide', '', 'success', 2),
    ],
    'yhk_palace_witness': [  # 殿試的證人
        ('verdict', '請女帝開「糊名謄錄」新制', 'success', 2),
    ],
    'yhj_unpaid': [  # 欠了三個月的餉
        ('tell', '', 'success', 1),
    ],
    'yhj_barracks_riot': [  # 營裡的鼓譟
        ('decide', '說服金墨盟借餉', 'success', 1),
    ],
    'yhs_canal_stone': [  # 運河上的奇石
        ('report', '', 'success', 1),
    ],
    'yhs_ledger': [  # 押司的帳
        ('give', '', 'success', 2),
    ],
    'yhs_sunken_stone': [  # 沉船的太湖石
        ('end', '說服女帝停綱', 'success', 2),
    ],
    'yhw_seamstress': [  # 繡娘的手
        ('give', '', 'success', 1),
    ],
    'yhw_bureau_gate': [  # 織造局的門
        ('end', '讓官府與行會立工約', 'success', 1),
    ],
    'yhx_two_notices': [  # 碼頭的兩張告示
        ('close', '', 'success', 1),
    ],
    'yhx_brawl': [  # 胡記與金玉行的火併
        ('close', '', 'success', 2),
    ],
    'yhx_lottery': [  # 市舶司的抽籤
        ('end', '分地盤，合辦海貿會館', 'success', 1),
    ],
    'yhg_new_formula': [  # 秦焰的新配方
        ('close', '', 'success', 1),
    ],
    'yhg_two_orders': [  # 兩張訂單
        ('end', '只賣煙火、不賣火器', 'success', 2),
    ],
    'yhq_rites_notice': [  # 禮部的告示
        ('talk', '', 'success', 1),
    ],
    'yhq_unruly_spirits': [  # 鬧仙
        ('close', '', 'success', 2),
    ],
    'yhq_elm_council': [  # 老榆樹下的議
        ('end', '堂口保留，編進官方的祀典', 'success', 2),
    ],
    'yhy_keeper_key': [  # 陵戶的鑰匙
        ('report', '', 'success', 1),
    ],
    'yhy_buried_generals': [  # 陪葬的將軍
        ('words', '答應替他們說出去', 'success', 2),
        ('words', '請他們安息', 'success', 2),
    ],
    'yhy_poisoned_rite': [  # 毒酒與祭典
        ('end', '把帛書封存起來', 'success', 3),
    ],
    'yhc_last_kiln': [  # 窯伯的最後一窯
        ('back', '', 'success', 1),
    ],
    'yhc_who_fired': [  # 天青是誰燒的
        ('end', '先只告訴窯伯', 'success', 2),
    ],
    'yhc_kiln_god': [  # 窯神
        ('end', '告訴她：是墨秋的', 'success', 3),
        ('end', '把窯火熄了', 'success', 3),
    ],
    'yhb_scavenger_find': [  # 拾荒人撿到的東西
        ('deal', '交給秦焰', 'success', 1),
        ('deal', '讓老鼠刀去賣（分一半）', 'success', 1),
    ],
    'yhb_four_years': [  # 四年前的爆炸
        ('end', '先收著，等對的時候', 'success', 2),
    ],
    'yhb_thunder_king': [  # 霹靂王
        ('end', '唸出三百個名字', 'success', 3),
        ('end', '拿走火銃，讓雷光散去', 'success', 3),
    ],
    'yhu_missing_piece': [  # 萍園缺的那一件
        ('return', '', 'success', 2),
    ],
    'yhu_drum': [  # 胡三太奶的鼓
        ('end', '', 'success', 2),
    ],
    'yht_new_tea': [  # 錢掌櫃的新茶
        ('end', '', 'success', 1),
    ],
    'yht_dragon_boat': [  # 虹橋下的龍舟
        ('end', '', 'success', 1),
    ],
    'yht_canal_rats': [  # 御溝的老鼠
        ('report', '', 'success', 1),
    ],
    'yhpol_new_policy': [  # 女帝的新政
        ('report', '', 'success', 4),
    ],
    'yhpol_backlash': [  # 宰相的反撲
        ('court', '', 'success', 4),
    ],
    'yhpol_petition': [  # 萬民書
        ('verdict', '「陛下親政，收回權柄」', 'success', 5),
        ('verdict', '「與萬民立憲（各方都退了一步）」', 'success', 3),
        ('verdict', '「與萬民立憲（兩邊勢均力敵）」', 'success', 3),
    ],
    'yczh_cold_tea': [  # 宣德樓頂的茶
        ('close', '「我會再來」', 'success', 1),
        ('close', '「她看起來很累」', 'success', 1),
    ],
    'yczh_audience': [  # 御街的燒鵝
        ('close', '「我敢」', 'success', 1),
        ('close', '「陛下想出去，就出去」', 'success', 1),
    ],
    'yczh_without_zhen': [  # 放下「朕」的那一夜
        ('confess', '抱住她', 'success', 2),
        ('confess', '「累了就靠著我」', 'success', 2),
    ],
    'yczh_x': [  # 昭華
        ('night', '讓她下令', 'success', 2),
        ('night', '讓她只當昭華', 'success', 2),
    ],
    'ycsz_banned_book': [  # 禁書
        ('close', '「下一本我也要看」', 'success', 1),
        ('close', '「妳不怕嗎？」', 'success', 1),
    ],
    'ycsz_secret_play': [  # 瓦舍偷演
        ('close', '擦掉她臉上的煙灰', 'success', 1),
        ('close', '「妳寫得真好」', 'success', 1),
    ],
    'ycsz_true_name': [  # 真名
        ('confess', '「寫妳的真名。我陪妳」', 'success', 2),
        ('confess', '「繼續當瀾生，我知道妳是誰就好」', 'success', 2),
    ],
    'ychn_lamp_oil': [  # 長明燈的燈油
        ('close', '「燈油裡為什麼會有祭文？」', 'success', 1),
        ('close', '陪她看燈', 'success', 1),
    ],
    'ychn_sealed_jar': [  # 燈座下的罈子
        ('close', '「信妳自己」', 'success', 1),
        ('close', '陪她坐到天亮', 'success', 1),
    ],
    'ychn_rekindle': [  # 重點長明燈
        ('confess', '「妳的燈點起來了」', 'success', 2),
        ('confess', '吻她', 'success', 2),
    ],
    'ychn_x': [  # 燈下
        ('night', '溫柔地帶她', 'success', 2),
        ('night', '讓她自己來', 'success', 2),
    ],
    'ycsh_false_seal': [  # 假公文
        ('close', '「妳打算怎麼辦？」', 'success', 1),
        ('close', '「妳不用一個人扛」', 'success', 1),
    ],
    'ycsh_forger': [  # 偽印的人
        ('close', '「現在就辦他」', 'success', 1),
        ('close', '陪她喝一杯', 'success', 1),
    ],
    'ycsh_her_seal': [  # 知府的私印
        ('confess', '「以後也在」', 'success', 2),
        ('confess', '握住她的手', 'success', 2),
    ],
    'ycsh_x': [  # 懷瑾
        ('night', '讓她照自己的規矩', 'success', 2),
        ('night', '讓她什麼都不用管', 'success', 2),
    ],
    'yclq_banned_song': [  # 被禁的工歌
        ('close', '「下次我也唱」', 'success', 1),
        ('close', '遞給她一壺水', 'success', 1),
    ],
    'yclq_bridge_song': [  # 虹橋上的歌
        ('close', '坐到她旁邊', 'success', 1),
        ('close', '「妳贏了」', 'success', 1),
    ],
    'yclq_to_longan': [  # 唱到龍安府
        ('confess', '「我也是」', 'success', 2),
        ('confess', '「說吧，我聽」', 'success', 2),
    ],
    'yclq_x': [  # 工歌的最後一段
        ('night', '讓她主導', 'success', 2),
        ('night', '溫柔地回應她', 'success', 2),
    ],
    'ycxq_stolen_painting': [  # 被偷的美人圖
        ('close', '「畫得很美」', 'success', 1),
        ('close', '「畫裡的人，跟你很像」', 'success', 1),
    ],
    'ycxq_court_painter': [  # 畫待詔
        ('close', '「你不用跟他們說什麼」', 'success', 1),
        ('close', '「你今晚很美」', 'success', 1),
    ],
    'ycxq_portrait': [  # 美人畫
        ('confess', '「只要你也在畫裡」', 'success', 2),
        ('confess', '「畫多少幅都可以」', 'success', 2),
    ],
    'ycxq_x': [  # 兩個人的美人圖
        ('night', '讓他畫你', 'success', 2),
        ('night', '把他抱起來', 'success', 2),
    ],
    'ychj_bodyguard': [  # 九娘的保鏢
        ('close', '「打開了，因為我想知道我在護什麼」', 'success', 1),
        ('close', '「箱子是空的，打手是妳的人吧」', 'success', 1),
    ],
    'ychj_false_debt': [  # 討債
        ('close', '「妳早就知道會是這樣」', 'success', 1),
        ('close', '陪她喝一杯', 'success', 1),
    ],
    'ychj_old_debt': [  # 三百年的舊債
        ('confess', '「那就別還，一直欠著」', 'success', 2),
        ('confess', '「這不是帳，是心意」', 'success', 2),
    ],
    'ychj_x': [  # 九娘的私帳
        ('night', '讓她一點一點地「算帳」', 'success', 2),
        ('night', '直接把她抱住', 'success', 2),
    ],
    'ycjy_missing_ship': [  # 少了一艘
        ('close', '「妳想說的時候再說」', 'success', 1),
        ('close', '「信在赤鬟手上吧」', 'success', 1),
    ],
    'ycjy_gamble': [  # 船艙的賭桌
        ('close', '「我不會說」', 'success', 1),
        ('close', '「妳在做很危險的事」', 'success', 1),
    ],
    'ycjy_thirty_ships': [  # 三十艘船
        ('confess', '「我也是」', 'success', 2),
        ('confess', '抱住她', 'success', 2),
    ],
    'ycjy_x': [  # 金玉行的頂樓
        ('night', '讓她像掌舵一樣', 'success', 2),
        ('night', '慢慢地帶她靠岸', 'success', 2),
    ],
    'ychw_confiscated_chart': [  # 被沒收的海圖
        ('close', '「下次出海帶上我」', 'success', 1),
        ('close', '「妳畫得真好」', 'success', 1),
    ],
    'ychw_compass_fish': [  # 指南魚
        ('close', '「那就去北邊」', 'success', 1),
        ('close', '「它也會指向回來的路」', 'success', 1),
    ],
    'ychw_north_coast': [  # 北原的海岸
        ('confess', '「以後不會了」', 'success', 2),
        ('confess', '握住她的手', 'success', 2),
    ],
    'ychw_x': [  # 船長室
        ('night', '讓她像開船一樣', 'success', 2),
        ('night', '慢慢地教她', 'success', 2),
    ],
    'ycyt_lost_lute': [  # 月琴
        ('close', '聽她唱', 'success', 1),
        ('close', '「以後別喝那麼多了」', 'success', 1),
    ],
    'ycyt_x': [  # 水裡的那一夜
        ('night', '讓她帶你游進深處', 'success', 2),
        ('night', '在淺灘上抱著她', 'success', 2),
    ],
    'ycap_flower_powder': [  # 會開花的火藥
        ('close', '「小心一點」', 'success', 1),
        ('close', '「妳一定做得出來」', 'success', 1),
    ],
    'ycap_colors': [  # 火的顏色
        ('close', '抱住她', 'success', 1),
        ('close', '拍拍她的頭', 'success', 1),
    ],
    'ycap_dragon_boat': [  # 龍舟節的煙火
        ('confess', '看著她，不看煙火', 'success', 2),
        ('confess', '「妳做到了」', 'success', 2),
    ],
    'ycap_x': [  # 第三十一發
        ('night', '讓她亂來', 'success', 2),
        ('night', '慢慢帶她', 'success', 2),
    ],
    'ycbx_city_songs': [  # 城裡的曲子
        ('close', '「唱吧，我在」', 'success', 1),
        ('close', '「我們先回去吧」', 'success', 1),
    ],
    'ycbx_contract': [  # 勾欄的契約
        ('close', '「為什麼不能兩樣都要？」', 'success', 1),
        ('close', '陪她坐著', 'success', 1),
    ],
    'ycbx_two_songs': [  # 神調與新曲
        ('confess', '「唱給我聽」', 'success', 2),
        ('confess', '抱住她', 'success', 2),
    ],
    'ycbx_x': [  # 炕頭
        ('night', '慢慢地教她', 'success', 2),
        ('night', '讓她跟著鼓點', 'success', 2),
    ],
    'yaxf_poached': [  # 挖角
        ('done', '「工錢就好」', 'success', 1),
        ('done', '「陪我喝一杯」', 'success', 1),
    ],
    'yaxf_stolen_play': [  # 搶戲
        ('done', '讓她主導', 'success', 1),
        ('done', '反過來主導她', 'success', 1),
    ],
    'yaxf_fire': [  # 火
        ('lover', '「我留下來」', 'success', 2),
        ('lover', '「勾欄我不要，我要妳」', 'success', 2),
    ],
    'yawr_lesson': [  # 尚寢局的課
        ('done', '認真地數', 'success', 1),
        ('done', '故意數錯', 'success', 1),
    ],
    'yawr_uncle': [  # 宰相的姪女
        ('done', '「我替妳寫一份給他」', 'success', 1),
        ('done', '「妳想怎麼回報？」', 'success', 1),
    ],
    'yawr_two_faces': [  # 兩面
        ('lover', '「這一課，換我教妳」', 'success', 2),
        ('lover', '「照妳教的來」', 'success', 2),
    ],
    'yaxs_destined': [  # 有緣人
        ('done', '「我是有緣人嗎？」', 'success', 1),
        ('done', '「妳家的人想做什麼？」', 'success', 1),
    ],
    'yaxs_family': [  # 天青鱗的家
        ('done', '照她說的修', 'success', 1),
        ('done', '「心無雜念我做不到」', 'success', 1),
    ],
    'yaxs_shrine': [  # 淫祠
        ('lover', '「一層一層來」', 'success', 2),
        ('lover', '「先跳到第九層」', 'success', 2),
    ],
    'yaql_storybook': [  # 話本裡的戀愛
        ('done', '牽著她的手', 'success', 1),
        ('done', '「話本下一頁寫什麼？」', 'success', 1),
    ],
    'yaql_winter': [  # 冬天
        ('done', '抱著她睡', 'success', 1),
        ('done', '生火，再抱著她', 'success', 1),
    ],
    'yaql_shedding': [  # 蛻皮
        ('lover', '「我幫妳」', 'success', 2),
        ('lover', '「我不走」', 'success', 2),
    ],
    'yasn_chosen': [  # 老仙看上的人
        ('done', '「其實我不介意」', 'success', 1),
        ('done', '「太奶說她要我」', 'success', 1),
    ],
    'yasn_two_hearts': [  # 兩個人搶
        ('done', '「只有妳」', 'success', 1),
        ('done', '「太奶教的我也會」', 'success', 1),
    ],
    'yasn_old_debt': [  # 情債
        ('lover', '「兩個都要」', 'success', 2),
        ('lover', '「我要的是三娘」', 'success', 2),
    ],
    'yach_first_hand': [  # 第一局
        ('bet', '押一百白鸛', 'success', 1),
        ('bet', '押我自己', 'success', 1),
    ],
    'yach_bigger_stake': [  # 更大的賭注
        ('done', '「我押妳先求饒」', 'success', 1),
        ('done', '「我押我先」', 'success', 1),
    ],
    'yach_last_hand': [  # 最後一把
        ('lover', '「我也賭我會留下來」', 'success', 2),
        ('lover', '「我賭妳不會讓我走」', 'success', 2),
    ],
    'yawy_errand': [  # 太妃宮的差事
        ('done', '「是陛下派我來的」', 'success', 1),
        ('done', '「我只是來當差的」', 'success', 1),
    ],
    'yawy_letters': [  # 宰相的信
        ('done', '留下來陪她', 'success', 1),
        ('done', '握住她的手', 'success', 1),
    ],
    'yawy_long_night': [  # 長夜
        ('lover', '「每一夜都可以」', 'success', 2),
        ('lover', '「今晚，和以後」', 'success', 2),
    ],
    'yayx_rumor': [  # 狐狸精的流言
        ('done', '走過去', 'success', 1),
        ('done', '「流言是從瓦舍傳出來的」', 'success', 1),
    ],
    'yayx_storyteller': [  # 說書的人
        ('done', '「太妃看著賞」', 'success', 1),
        ('done', '「想聽先帝的事」', 'success', 1),
    ],
    'yayx_last_words': [  # 先帝的最後一句話
        ('lover', '「那就迷惑我吧」', 'success', 2),
        ('lover', '「這次換我迷惑妳」', 'success', 2),
    ],
    'yg_five_seats': [  # 五席的夜宴
        ('banquet', '坐下，「請五席裁決」', 'success', 2),
        ('banquet', '「我能先喝一杯嗎？」', 'success', 2),
    ],
    'yg_two_generations': [  # 太妃宮的兩代同堂
        ('night', '「和解吧」', 'success', 2),
        ('night', '「各自的秘密就留著吧」', 'success', 2),
    ],
    'yg_hu_reunion': [  # 胡家的團圓宴
        ('feast', '「城裡的狐、屯裡的狐，都是一家」', 'success', 2),
        ('feast', '「吃完這頓，各過各的」', 'success', 2),
    ],
    'yg_gold_ink': [  # 金與墨
        ('roof', '握住兩隻手', 'success', 2),
        ('roof', '「妳們先分出勝負」', 'success', 2),
    ],
    'yhink_grind': [  # 研墨
        ('row', '一間一間去添香', 'success', 1),
        ('row', '只替第一間的書生添一夜的香', 'success', 1),
    ],
    'yhink_ease': [  # 考前的解乏
        ('corridor', '整條廊一間一間解', 'success', 1),
        ('corridor', '只替看起來會中的那幾個解', 'success', 1),
    ],
    'yhink_list': [  # 杏榜的那一夜
        ('poem', '陪新科進士們題滿全身的詩', 'success', 1),
        ('poem', '下樓陪落第的整排客房', 'success', 1),
    ],
    'yhboat_oar': [  # 搖櫓
        ('tip', '跪下來用嘴叼', 'success', 1),
        ('tip', '用手拿，再多收他一份船錢', 'success', 1),
    ],
    'yhboat_flute': [  # 船艙的小曲
        ('flute', '一個一個吹', 'success', 1),
        ('flute', '撩起簾子，讓運河兩岸聽', 'success', 1),
    ],
    'yhboat_charter': [  # 包船的夜
        ('charter', '在船艙裡讓他們輪著來', 'success', 1),
        ('charter', '被抬到船頭，讓整條運河看', 'success', 1),
    ],
    'yhpearl_dive': [  # 下水
        ('warm', '讓他們摟著暖', 'success', 1),
        ('warm', '裹著毯子自己縮在船艙裡', 'success', 1),
    ],
    'yhpearl_heat': [  # 取暖
        ('thanks', '用嘴一個一個謝', 'success', 1),
        ('thanks', '用手，一次兩個', 'success', 1),
    ],
    'yhpearl_big': [  # 大珠
        ('feast', '全船的人在船艙裡輪流取暖', 'success', 2),
        ('feast', '躺在甲板上，讓整個碼頭來看', 'success', 2),
    ],
    'yhkang_fire': [  # 燒炕
        ('pot', '用手替他倒', 'success', 1),
        ('pot', '把尿壺塞給他，自己去倒', 'success', 1),
    ],
    'yhkang_quilt': [  # 暖被窩
        ('caravan', '留在炕上，用嘴焐完炕上的人', 'success', 1),
        ('caravan', '鑽進人馬族的氈毯（人馬族，人外）', 'success', 1),
    ],
    'yhkang_winter': [  # 貓冬
        ('winter', '一整炕輪著來', 'success', 2),
        ('winter', '跟北原的馬幫走進馬棚（人馬族，人外）', 'success', 2),
    ],
    'yhinc_lot': [  # 求籤
        ('first', '跪在龍母像前讓他借', 'success', 1),
        ('first', '只讓他用嘴「借」', 'success', 1),
    ],
    'yhinc_doll': [  # 拴娃娃
        ('boatmen', '照收據一個一個借', 'success', 1),
        ('boatmen', '只讓廟祝一個人借，船工們用手', 'success', 1),
    ],
    'yhinc_sea': [  # 海裡的龍母
        ('ships', '一條船一條船地沾', 'success', 1),
        ('ships', '只讓七個船老大沾', 'success', 1),
    ],
    'yhinc_elm': [  # 老榆樹的紅布
        ('tree', '躺在皮襖上，一個一個來', 'success', 2),
        ('tree', '抱著樹，讓他們一起', 'success', 2),
    ],
    'yhlantern_walk': [  # 走百病
        ('riddle', '讓出謎的人摸個夠', 'success', 1),
        ('riddle', '用嘴換一個提示', 'success', 1),
    ],
    'yhlantern_pearl': [  # 龍珠
        ('caught', '鑽進龍身底下，一節一節侍奉', 'success', 1),
        ('caught', '只侍奉龍頭', 'success', 1),
    ],
    'yhlantern_night': [  # 金吾不禁
        ('swallow', '讓九節一節一節來', 'success', 1),
        ('swallow', '讓整條龍一口吞下，九個人一起', 'success', 1),
    ],
    'yhqiqiao_needle': [  # 穿針
        ('cowherds', '讓每個牛郎摸一處', 'success', 1),
        ('cowherds', '坐到梭爺腿上，替他喝', 'success', 1),
    ],
    'yhqiqiao_bridge': [  # 鵲橋
        ('toll', '跪下來，每隻喜鵲用嘴付', 'success', 1),
        ('toll', '讓喜鵲們在橋上一起收', 'success', 1),
    ],
    'yhqiqiao_meet': [  # 七夕會
        ('meet', '讓所有牛郎輪流相會到天亮', 'success', 2),
        ('meet', '用絲線把自己綁在織機上', 'success', 2),
    ],
    'yhfoxwed_sit': [  # 坐福
        ('look', '掀開禮服讓他們看', 'success', 1),
        ('look', '蓋頭不掀，用嘴打發他們', 'success', 1),
    ],
    'yhfoxwed_bride': [  # 迎親
        ('groomsmen', '讓伴郎一個一個試', 'success', 1),
        ('groomsmen', '回花轎裡讓他們一起試', 'success', 1),
    ],
    'yhfoxwed_chamber': [  # 鬧洞房
        ('chamber', '讓整屯的小伙子鬧到天亮', 'success', 2),
        ('chamber', '戴上狐尾，當一夜真正的狐新娘', 'success', 2),
    ],
    'yasz_widow': [  # 牌坊下的寡婦
        ('promise', '「我不會說出去」', 'success', 1),
        ('promise', '「戴上它的時候，妳快樂嗎」', 'success', 1),
    ],
    'yasz_banquet': [  # 無面宴
        ('door', '「把面具摘下來，看著我」', 'success', 1),
        ('door', '「戴上吧，我在樓下等妳」', 'success', 1),
    ],
    'yasz_arch': [  # 牌坊之前
        ('lover', '「今晚，妳想怎樣都可以」', 'success', 2),
        ('lover', '把她的手拉開，看著她的臉', 'success', 2),
    ],
    'yasz_faceless': [  # 無面樓
        ('answer', '「妳還是妳，我要妳」', 'success', 2),
        ('answer', '讓她自己決定要不要回來', 'success', 2),
    ],
    'club_shen_faceless': [  # 瀾生的面具
        ('answer', '「瀾生寫真話，沈知瀾是我的」', 'success', 2),
        ('answer', '「下次我也戴上面具，陪妳一起聽」', 'success', 2),
    ],
    'club_yaoting_faceless': [  # 最後一個走的客人
        ('answer', '「宴會散不散場都好，最後我都會找到妳」', 'success', 2),
        ('answer', '「下次我也戴面具，陪妳喝到最後」', 'success', 2),
    ],
}

TIDAN = {
    'tdn_tea_caravan': [  # 茶馬路的商隊
        ('deliver', '', 'success', 2),
    ],
    'tdn_market_rules': [  # 榷場的規矩
        ('deal', '照規矩付三成', 'success', 2),
        ('deal', '只付牌子上寫的一成', 'success', 2),
    ],
    'tdr_ovoo_bones': [  # 敖包上的骨紋
        ('close', '', 'success', 2),
    ],
    'tdr_wolf_deer_song': [  # 蒼狼與白鹿的歌
        ('sing', '', 'success', 3),
    ],
    'tdr_name_of_tengri': [  # 長生天的名字
        ('call', '先叫蒼狼部的祖先', 'success', 3),
        ('call', '先叫媞丹部的祖先', 'success', 3),
        ('call', '先叫海東部的祖先', 'success', 3),
    ],
    'tdl_blood_feud': [  # 血仇
        ('close', '', 'success', 2),
    ],
    'tdl_the_code': [  # 大法典
        ('end', '寫進北院的軍法', 'success', 3),
        ('end', '照大燁律改寫，交給南院', 'success', 3),
        ('end', '寫下各部自治、減輕貢賦', 'success', 1),
    ],
    'tds_two_ledgers': [  # 兩本帳
        ('report', '', 'success', 2),
    ],
    'tds_missing_tribute': [  # 少了的歲幣
        ('end', '把銀子分給海東部抵貢', 'success', 1),
    ],
    'tdt_night_horses': [  # 夜裡的馬群
        ('tell', '', 'success', 1),
    ],
    'tdt_smugglers_trail': [  # 走私的路
        ('report', '', 'success', 2),
    ],
    'tdt_tea_horse': [  # 茶馬互市
        ('end', '交給北院練騎兵', 'success', 1),
    ],
    'tdh_pearl_divers': [  # 採珠人
        ('close', '', 'success', 2),
    ],
    'tdh_tribute_day': [  # 進貢的日子
        ('end', '請南院替海東部減貢', 'success', 1),
    ],
    'tdm_named_arrow': [  # 刻著名字的鳴鏑
        ('report', '', 'success', 1),
    ],
    'tdm_iron_pagoda': [  # 鐵浮屠的盟誓
        ('ask', '「他叫什麼名字？」', 'success', 2),
        ('ask', '「你想讓我知道嗎？」', 'success', 2),
    ],
    'tdm_nameless_khan': [  # 無名的可汗
        ('end', '「你叫阿勒坦」', 'success', 3),
        ('end', '「我會替你問出來」', 'success', 3),
        ('end', '「名字是天可汗抹掉的，去問她」', 'success', 3),
    ],
    'tdw_coming_of_age': [  # 成年禮
        ('back', '', 'success', 1),
    ],
    'tdw_ice_queen': [  # 冰后的宮殿
        ('ask', '「牠會問什麼？」', 'success', 2),
        ('ask', '打碎冰，放巫師走', 'success', 2),
    ],
    'tdw_blue_wolf': [  # 蒼狼
        ('end', '「草原統一了，牠們是一家人」', 'success', 3),
        ('end', '「兄弟殺了兄弟，名字被刮掉了」', 'success', 3),
        ('end', '「最小的那一支，還在鷹河邊等著」', 'success', 3),
    ],
    'tdu_broken_fiddle': [  # 斷弦的馬頭琴
        ('play', '', 'success', 2),
    ],
    'tdx_post_letter': [  # 驛站的急信
        ('back', '', 'success', 1),
    ],
    'tdx_lost_foal': [  # 走失的小馬
        ('back', '', 'success', 1),
    ],
    'tdpol_summons': [  # 天可汗的召見
        ('report', '', 'success', 4),
    ],
    'tdpol_kurultai': [  # 忽里勒台
        ('verdict', '', 'success', 4),
    ],
    'tdpol_naadam': [  # 那達慕之約
        ('verdict', '「長生天的鞭：整軍南下」', 'success', 2),
        ('verdict', '「長生天的鞭：整軍南下」（那達慕的聲音）', 'success', 2),
        ('verdict', '「南院的印：定居築城」', 'success', 2),
        ('verdict', '「南院的印：定居築城」（那達慕的聲音）', 'success', 2),
    ],
    'nspol_envoys': [  # 歲幣的使節
        ('report', '', 'success', 3),
    ],
    'nspol_market_fire': [  # 榷場的火
        ('tell', '在茶馬市當眾念出來', 'success', 3),
        ('tell', '只交給兩國的使節', 'success', 3),
    ],
    'nspol_night_council': [  # 兩國的夜議
        ('council', '「征伐：天可汗南下」', 'success', 2),
        ('council', '「和盟：讓五席的人斡旋」', 'success', 2),
        ('council', '「和盟：歲幣改成互市」', 'success', 2),
        ('council', '「征伐：北院的殘部南下」', 'success', 2),
        ('council', '「和盟：女帝寧可和天可汗談」', 'success', 2),
    ],
    'nspol_end_war': [  # 征伐
        ('blade', '', 'success', 5),
    ],
    'tdcu_winter_hunt': [  # 冬獵的勢子
        ('close', '「怕。可是馬比較要緊」', 'success', 1),
        ('close', '「妳的箭沒有射偏過吧」', 'success', 1),
    ],
    'tdcu_night_hunt': [  # 夜獵
        ('close', '「因為妳說話算話」', 'success', 1),
        ('close', '「怕。可是我更想知道妳在想什麼」', 'success', 1),
    ],
    'tdcu_not_afraid': [  # 不怕她的人
        ('confess', '走過去，握住她的手', 'success', 2),
        ('confess', '「下一次，我還站在妳前面」', 'success', 2),
    ],
    'tdcu_x': [  # 狼皮上
        ('night', '讓她像打獵一樣', 'success', 2),
        ('night', '讓她什麼令都不下', 'success', 2),
    ],
    'tdcc_false_name': [  # 假名字
        ('close', '「知道。可是我陪的是阿勒泰」', 'success', 1),
        ('close', '「妳是察蘭，跑得比我快的人」', 'success', 1),
    ],
    'tdcc_fixed_race': [  # 放水的人
        ('close', '「把錢還給騎手，請他們真的跑」', 'success', 1),
        ('close', '「告訴天可汗，可是讓妳自己說」', 'success', 1),
    ],
    'tdcc_true_name': [  # 用真名贏
        ('confess', '「妳跑得真好，察蘭」', 'success', 2),
        ('confess', '「下次，我想贏妳」', 'success', 2),
    ],
    'tdcc_x': [  # 賽道的盡頭
        ('night', '讓她「贏」', 'success', 2),
        ('night', '慢慢來', 'success', 2),
    ],
    'tdcq_war_horse_bone': [  # 戰馬的骨
        ('close', '「想」', 'success', 1),
        ('close', '「不想。我想知道妳看見了什麼」', 'success', 1),
    ],
    'tdcq_night_reading': [  # 夜裡的占卜
        ('close', '握住她發抖的手', 'success', 1),
        ('close', '「那就讓它不要發生」', 'success', 1),
    ],
    'tdcq_unwelcome': [  # 不受歡迎的預言
        ('confess', '「那一道是我」', 'success', 2),
        ('confess', '「不用讀骨，我告訴妳將來」', 'success', 2),
    ],
    'tdcq_x': [  # 不讀骨的夜
        ('night', '讓她讀你', 'success', 2),
        ('night', '沿著她的紋', 'success', 2),
    ],
    'tdch_lost_messenger': [  # 沒換馬的信差
        ('close', '「那是妳的信」', 'success', 1),
        ('close', '「妳想讓我看嗎？」', 'success', 1),
    ],
    'tdch_night_ride': [  # 夜裡的路
        ('close', '「不會」', 'success', 1),
        ('close', '「我不會說，可是我不贊成」', 'success', 1),
    ],
    'tdch_traitor': [  # 冬營的叛徒
        ('confess', '「那就選」', 'success', 2),
        ('confess', '抱住她', 'success', 2),
    ],
    'tdch_x': [  # 冬營的火
        ('night', '讓她自己來', 'success', 2),
        ('night', '一點一點教她', 'success', 2),
    ],
    'tdct_snow': [  # 雪
        ('close', '陪她坐著', 'success', 1),
        ('close', '「還有十天」', 'success', 1),
    ],
    'tdct_hidden': [  # 藏起來的鷹
        ('close', '「不會。妳只是捨不得」', 'success', 1),
        ('close', '「我陪妳一起自私」', 'success', 1),
    ],
    'tdct_let_go': [  # 放手
        ('confess', '「我不會飛走」', 'success', 2),
        ('confess', '牽起她的手', 'success', 2),
    ],
    'tdct_x': [  # 鷹房的閣樓
        ('night', '很溫柔地', 'success', 2),
        ('night', '讓她決定什麼時候', 'success', 2),
    ],
    'tdg_twin_empresses': [  # 雙帝的會盟
        ('night', '「那就照盟約來」', 'success', 2),
        ('night', '「兩位陛下先分出勝負」', 'success', 2),
    ],
    'tdwn_secret': [  # 可敦的秘密
        ('promise', '「我不會說出去」', 'success', 1),
        ('promise', '「妳想看的，現在就在妳面前」', 'success', 1),
    ],
    'tdwn_secret_other': [  # 可敦的秘密
        ('promise', '「我不會說出去」', 'success', 1),
        ('promise', '「妳想要的，不是看而已吧」', 'success', 1),
    ],
    'tdwn_after_naadam': [  # 那達慕之後的夜
        ('want', '「讓妳看著我」', 'success', 1),
        ('want', '「去吧，我在帳外等妳」', 'success', 1),
    ],
    'tdwn_choice': [  # 可敦的選擇
        ('lover', '「今晚，妳想怎樣都可以」', 'success', 2),
        ('lover', '把她抱起來', 'success', 2),
    ],
    'tdwn_wild_horse': [  # 野馬帳
        ('answer', '「妳還是妳，我要妳」', 'success', 2),
        ('answer', '讓她自己決定要不要回來', 'success', 2),
    ],
    'tdur_wild_stallion': [  # 最烈的馬
        ('done', '「試試就知道」', 'success', 1),
        ('done', '「妳先說，妳能撐多久」', 'success', 1),
    ],
    'tdur_who_rides': [  # 誰騎誰
        ('done', '讓她騎', 'success', 1),
        ('done', '反過來騎她', 'success', 1),
    ],
    'tdur_bridle': [  # 韁繩
        ('lover', '「我不套，我陪妳跑」', 'success', 2),
        ('lover', '把韁繩輕輕繞上她的手腕', 'success', 2),
    ],
    'tdsr_foaling': [  # 接生
        ('done', '下水陪她', 'success', 1),
        ('done', '「春天是什麼意思？」', 'success', 1),
    ],
    'tdsr_stud': [  # 種馬
        ('done', '「那就不怪妳」', 'success', 1),
        ('done', '慢慢地陪她', 'success', 1),
    ],
    'tdsr_herd': [  # 她的馬群
        ('lover', '「不是春天也要」', 'success', 2),
        ('lover', '「那春天呢？」', 'success', 2),
    ],
    'tdg_golden_three': [  # 金帳的三人
        ('night', '「讓察蘭先」', 'success', 2),
        ('night', '「這一次，比別的」', 'success', 2),
    ],
    'tdwn_after_naadam_other': [  # 那達慕之後的夜
        ('want', '「去吧，我在帳外等妳」', 'success', 1),
    ],
    'tdtongue_hands': [  # 兩邊的手
        ('split', '晚上去通譯行學', 'success', 2),
        ('split', '拿小的那份就好', 'success', 2),
    ],
    'tdtongue_extra': [  # 成交的添頭
        ('horse_side', '讓三個馬販輪流（人馬族，人外）', 'success', 2),
        ('horse_side', '用手和嘴打發他們', 'success', 2),
    ],
    'tdtongue_market': [  # 秋市
        ('market', '跟茶商們（化龍族）', 'success', 2),
        ('market', '跟馬販們（人馬族，人外）', 'success', 2),
        ('market', '兩邊一起，翻話翻到說不出話', 'success', 2),
    ],
    'yhinc_ovoo': [  # 北原的敖包
        ('ovoo', '讓整個驛站的牧人把敖包添滿（人馬族，人外）', 'success', 2),
        ('ovoo', '把劉嬤嬤也拉下來一起添（人馬族，人外）', 'success', 2),
        ('ovoo', '跟劉嬤嬤分帳，從此自己當香頭（人馬族，人外）', 'success', 2),
    ],
    'tdnaadam_target': [  # 靶子
        ('archers', '讓七個射手一個一個摸個夠', 'success', 2),
        ('archers', '用嘴替射得最準的那個領彩頭', 'success', 2),
    ],
    'tdnaadam_race': [  # 賽馬的彩頭
        ('tent', '用手和嘴伺候三個', 'success', 2),
        ('tent', '讓三個人輪流上（人馬族，人外）', 'success', 2),
    ],
    'tdnaadam_wrestle': [  # 摔跤的冠軍
        ('prize', '只給摔跤的冠軍一個人（人馬族，人外）', 'success', 2),
        ('prize', '被抬到場中央，三藝的優勝者一起（人馬族，人外）', 'success', 2),
    ],
    'club_chihuan_wild': [  # 押在野馬帳的一把
        ('answer', '「我押妳。一直都押妳」', 'success', 2),
        ('answer', '「下次，我跟妳押同一把」', 'success', 2),
    ],
    'club_urina_wild': [  # 誰騎誰・野馬帳
        ('answer', '「妳贏了。韁繩我還是要牽」', 'success', 2),
        ('answer', '「下次換我跟妳一起馴」', 'success', 2),
    ],
    'club_hailan_wild': [  # 放下弓的一夜
        ('answer', '「我不放手」', 'success', 2),
        ('answer', '「下次，我陪妳一起放下」', 'success', 2),
    ],
}

def outcomes(story, node_id, label, kind):
    """表的一列對到的結局：選項文字 '' 是節點本身，'*' 是節點的每個選項"""
    node = next((n for n in story['nodes'] if n['id'] == node_id), None)
    assert node, f"{story['id']}：找不到節點 {node_id}"
    if label == '':
        holders = [node]
    elif label == '*':
        holders = node.get('options', [])
    else:
        holders = [o for o in node.get('options', []) if o.get('label', '').startswith(label)]
    found = [h[kind] for h in holders if isinstance(h.get(kind), dict)]
    assert found, f"{story['id']}／{node_id}：找不到「{label}」的 {kind}"
    for r in found:
        assert r.get('complete'), f"{story['id']}／{node_id}／{label}：不是結局"
    return found


def set_rep(result, faction, delta):
    effects = [e for e in result.get('effects', []) if not (e.get('type') == 'reputation' and e.get('faction') == faction)]
    if delta:
        effects.append({'type': 'reputation', 'faction': faction, 'delta': delta})
    if effects:
        result['effects'] = effects
    else:
        result.pop('effects', None)


def main():
    data = json.load(open(PATH, encoding='utf-8'))
    by_id = {s['id']: s for s in data['stories']}
    changed = {}
    for faction, table in (('human_alliance', RIVERVALE), ('yanye_court', YANYE), ('tidan_khanate', TIDAN)):
        for sid, rows in table.items():
            story = by_id.get(sid)
            assert story, f'找不到任務 {sid}'
            before = json.dumps(story, ensure_ascii=False)
            for node_id, label, kind, delta in rows:
                for r in outcomes(story, node_id, label, kind):
                    set_rep(r, faction, delta)
            if json.dumps(story, ensure_ascii=False) != before:
                changed[sid] = story
    if changed:
        write_stories(list(changed.values()))
    print(f'改了 {len(changed)} 個任務的結局聲望')


if __name__ == '__main__':
    main()
