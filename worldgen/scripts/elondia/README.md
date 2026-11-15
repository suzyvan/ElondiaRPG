# 艾隆迪亞內建內容的產生腳本

內建世界（`data/`）大部分的特殊任務、獨特裝備、地下城事件與寄生物是這些腳本產生的。**一律在 repo 根目錄執行**（路徑都是相對於 repo 根目錄），例如 `python3 worldgen/scripts/elondia/story_batch1.py`。

## 可以重跑（重跑會得到目前的資料）

改內容時改這些腳本、再重跑，不要直接改產生出來的 JSON（直接改的話，下次重跑會被蓋掉）。

| 腳本 | 寫進 | 說明 |
|---|---|---|
| `story_batch1.py` | `data/rules/stories.json` | 所有特殊任務：匯入 `story_batch2`～`story_batch31`，再套用 `epic_places.place_epics`（史詩頭目戰的特殊地圖）、`uniq23.place_gear`（任務的獨特裝備）、`adult_scenes26.place_scenes`（親密場景）、`lust_skills_s6.place_skills`（打工線的獨特技能，接在結局的獎勵物品後面），最後接上 `lust_park_s7.PARK_STORIES`（緋夢樂園的集章任務）。以 git 的 `2fa8ee9` 版的 stories.json 為底，後面接上這些批次。**現在不要重跑**：之後炎華之地的任務（`east_*`）、角色線（`char_lines38.py`）直接寫進 stories.json，內建任務的時段（R13）也是直接改的，重跑會把這些都蓋掉 |
| `epic_guide41.py` | `data/rules/stories.json` | 「史詩的指引」：接了任何一條政治（結果會動到 `human_stance`、`demon_stance` 的故事線）或巨龍相關（巨龍史詩的結局會看的五條線）的任務就自動開始（`start.kind = auto`），指引到河谷鎮公會的政治史詩，政治史詩落幕後指引到巨龍史詩。觸發的旗標從 stories.json 算出來，可以重跑 |
| `uniq23.py` | `data/rules/items.json` | 任務的獨特裝備 149 件 |
| `dungeon_events24.py` | `data/rules/travel_events.json`、`companions.json` | 地下城的色情事件與它們的非戰鬥狀態。**現在不能直接重跑**：後來的腳本加了別的地下城事件（結尾的件數檢查會失敗），也改過其中五件的選項（太真實的夢、鑽進睡袋的史萊姆……），重跑會蓋掉；帶來寄生物的四件的陽剛體型版本在 `parasite_lures51.py` |
| `lust_gather34.py` | `data/rules/travel_events.json` | 成人向的採集事件 12 件（不限地下城 8 件、地區限定 4 件；接在「遺落的春宮書」後面）。可以重跑 |
| `dungeon_events33.py` | `data/rules/travel_events.json` | 普通（非成人向）的地下城與近郊事件 54 件：採集 19、陷阱 13、寶箱 11、安全房長休 11（接在成人向的「遺落的春宮書」後面）。可以重跑 |
| `sex_seeds42.py` | `data/world/npcs.json` | 固定 NPC 的初始性經歷（`sex`，[LEWD_STATS](../../../docs/LEWD_STATS.md) 第 29 節）：設定寫得清楚的 40 位成人向角色（還是處女、人妻、寡婦、當過奴隸、花魁、老師……）。只改每個人 id 那一行的 `sex`。可以重跑 |
| `vacuum37.py` | `data/rules/gear.json`、`data/rules/lewd.json` | 真空會走光的常規服裝（底材的 `vacuum`：裙子、薄襯衫、浴衣）與在聚落裡真空的淫亂成長（`daily.vacuum`）。可以重跑 |
| `lead_events35.py` | `data/rules/travel_events.json` | 線索事件 12 件（`scope: lead`，有登場角色 `{a}`、`{b}`；接在旅途事件的「神父的告解」後面）。可以重跑 |
| `parasites25.py` | `data/rules/parasites.json`、`items.json`、`companions.json`、`travel_events.json` | 寄生物的規則、物品、發作事件 |
| `work26.py` | `data/rules/items.json`、`data/world/npcs.json`、`landmarks.json` | 打工任務線（成人向）的獨特色情裝備、委託人與地標：自己的五條線，加上 `story_batch27.py`、`story_batch28.py` 匯出的 `ITEMS27`～`30`、`NPCS27`～`30`、`LANDMARKS27`～`30`（任務本身在 `story_batch26`～`30`；制服的表在 `story_batch26.py` 的 `DRESS` 與 `DRESS29`、`DRESS30`） |
| `town_events26.py` | `data/rules/travel_events.json` | 城鎮的成人向事件（搜身盤查、被下藥的酒、賭局的代價、被搭訕、被偷摸） |
| `dragon_text27.py` | `data/rules/enemies.json`、`data/worldbook/elondia.worldbook.json` | 巨龍不可名狀：投影與守衛的描述、世界書「高維巨龍」條目的不可溝通原則與三條龍的動機（可以重跑，改過的不再改） |
| `npc_looks27.py` | `data/world/npcs.json` | 固定 NPC 的外貌細節（資料在 `npc_looks27.json`；要排在 `work26.py` 之後，因為 work26 會重寫打工線的委託人） |
| `npc_looks40.py` | `data/world/npcs.json` | 東大陸有角色線的固定 NPC 的外貌細節：身高、身形（人馬族寫連馬身的高度）、玉璘族的鱗尾（資料在 `npc_looks40.json`；要排在東大陸的 `east_p*.py` 之後） |
| `yulin_body32.py` | `data/worldbook/elondia.worldbook.json`、`data/world/npc_traits.json`、`data/rules/stories.json`（連同 `story_batch16.py`、`story_batch18.py`） | 玉璘族除了魚尾也有雙腿（魚尾長在腰後，像鯨尾一樣粗圓，尾端是寬大的尾鰭；上岸不必化形）：世界書的種族、隨機 NPC 的種族特徵、特殊任務裡「雙腿化回魚尾」的句子。固定 NPC 的外貌在 `npc_looks27.json`。可以重跑 |
| `lust_park_s7.py` | `data/rules/abilities.json`、`enemies.json`、`items.json`、`lewd.json`、`data/world/geography.json`、`maps.json`、`special_maps.json`、`landmarks.json`、`npcs.json` | 魅魔的遊樂園「緋夢樂園」（慾望戰鬥 S7，[LUST_PARK](../../../docs/LUST_PARK.md)）：怪物、技能、物品、五個園區、入口廣場、售票亭、接待員、園區的規則；集章任務由 `story_batch1.py` 匯入。要排在 `interiors23.py`、`epic_places.py`、`uniq23.py`、`work26.py`、`npc_looks27.py` 之後（它們會重寫同一個檔案）。可以重跑；怪物的生命與攻擊加成在 `TUNE` |
| `lust_s8.py` | `data/rules/items.json`、`statuses.json`、`companions.json`、`lewd.json`、`gear.json`、`tattoos.json`、`abilities.json`、`parasites.json`、`slavery.json` | 慾望戰鬥 S8 的資料（[LEWD_STATS](../../../docs/LEWD_STATS.md) 第 13 節起）：消耗品、料理、征服掉落、輔料的魅惑方向、淫紋、寄生物的階段、印記的順從累積、鑰匙與戰鬥中的拘束。要排在 `lust_park_s7.py` 之後。可以重跑 |
| `lust_s9.py` | `data/rules/gear.json`、`items.json`、`lewd.json`、`shops.json`、`enemies.json`、`travel_events.json` | 慾望戰鬥 S9 的資料（[LEWD_STATS](../../../docs/LEWD_STATS.md) 第 7、27 節、[ADULT_EVENTS](../../../docs/ADULT_EVENTS.md) 第 4 節）：封住嘴巴、16 件拘束具、商店每天另外上架的拘束具、寶箱與其他來源；24 件地下城事件、20 件魅氣濃的城鎮事件、8 件旅途事件（也寫 `travel_events.json`）；12 種淫服底材與 42 件淫服（S9-6）。要排在 `lust_s8.py` 之後。可以重跑 |
| `high_dungeons31.py` | `data/rules/abilities.json`、`enemies.json`、`items.json`、`lewd.json`、`data/world/geography.json`、`maps.json`、`special_maps.json`、`data/worldbook/elondia.worldbook.json` | 高等級的地下城（Lv.13～20，[DUNGEON_DESIGN](../../../docs/DUNGEON_DESIGN.md) 第 8 節）：歷史裂縫、歷史迴廊、緋夢樂園底下的禁果庭園與歡愉秘宮的怪物、技能、物品、遭遇表、地點與路線、入口廣場的兩道鐵柵、園區規則（遺跡的戰敗、擬態寶箱、不蓋章）與世界書條目；任務在 `story_batch31.py`。要排在 `lust_s9.py` 之後（`lust_park_s7.py` 會重寫入口廣場與 `lewd.json` 的 park）。可以重跑；怪物的生命與攻擊加成在 `TUNE` |
| `material_drops31.py` | `data/rules/enemies.json`、`items.json`、`town_quests.json`、`data/world/maps.json` | 材料的取得量：怪物掉材料至少 80%、第 4 級只在 Lv.8 以上的層主、第 5 級只在底層層主、每種類型的第 5 級都有底層層主會掉；藥草、光泉水上架；熒光苔蘚加進地下城採集；材料委託的份數。設定的是結果，可以重跑；改了怪物掉落的腳本（`lust_s9.py` 等）重跑之後也要再跑這個 |
| `high_gear31.py` | `data/rules/gear.json`、`crafts.json`、`equipment.json`、`items.json` | 高等地下城的裝備（[ITEMS](../../../docs/ITEMS.md) 第 4.5 節）：第 6、7 級材料與打造材料、打造延伸到第 7 級、一般底材 9 種與地下城專屬的底材 10 種（新的武器與防具類型）、制式裝備、專屬底材的裝備與傳說的獨特裝備；層主的掉落（`DROPS`）由 `high_dungeons31.py` 讀進去。要排在 `high_dungeons31.py` 之前。可以重跑 |
| `lust_s10.py` | `data/world/npcs.json`、`data/rules/items.json`、`lewd.json`、`perks.json` | 慾望戰鬥 S10 的資料（[LEWD_STATS](../../../docs/LEWD_STATS.md) 第 6.1、14.1、28 節）：8 位流派的老師與 `perks.json` 的 `mentor` 預設、8 本秘法書（商店、拍賣會、園區寶箱）、寄生類的雙面效應（`parasite_two_face`）、稱號（`titles`）。要排在 `lust_s9.py`、`material_drops31.py` 之後。可以重跑 |
| `char_lines38.py` | `data/rules/stories.json`、`enemies.json`、`items.json`、`data/world/npcs.json` | 角色線（R9）：白百合巡禮、全城跑最快的精靈各四個任務（用 `east_story_io.write_stories` 就地換掉同 id 的任務）、捕奴隊的打手與頭目灰狗、霧銀耳墜、奧菈莉婭、格溫德琳、琥珀的 `no_attack`、結局之後的 `stages` 與琥珀的成人向外貌。可以重跑 |
| `east_p9_work.py` | `data/rules/stories.json`、`items.json`、`gear.json`、`abilities.json`、`lewd.json`、`data/world/npcs.json`、`landmarks.json` | 炎華之地的打工線（R26 第一批，成人向）：五條線 15 個任務、五位委託人、四個新地標與上工的場景、五件獨特裝備、五個獨特技能與技能書（加進淫鬥場、拍賣會、園區寶箱）、新底材肚兜與它的制式品。要排在 `east_p3_places.py`、`east_p7_people.py` 之後（它們整筆重寫地標）。可以重跑 |
| `east_p9_fest.py` | `data/rules/stories.json`、`items.json`、`gear.json`、`abilities.json`、`lewd.json`、`data/world/npcs.json`、`data/worldbook/elondia.worldbook.json` | 炎華之地的巡禮與祭典（R26 第二批，成人向）：龍母祠的求子香五站、四個祭典各三個任務、五位委託人、五件獨特裝備、五個獨特技能與技能書、新底材紅蓋頭與褻褲和它們的制式品、世界書的龍母祠。寫檔的函式借 `east_p9_work.py` 的。要排在 `east_p9_work.py` 之後（用到肚兜；兩支都把委託人接在 npcs.json 最後，順序反過來時委託人的排列會不同）、`east_p4a_races.py` 之後（它寫神祇信仰）。可以重跑 |
| `underworld39.py` | `data/world/special_maps.json`、`landmarks.json` | 地下街（[SPECIAL_MAPS](../../../docs/SPECIAL_MAPS.md) 第 9 節）：有黑市或魅氣 3 以上的聚落各一張隱藏地圖（`sm_uw_<地點>`），裡面擺黑市與地下淫鬥場的地標（`lm_uw_black_<地點>`、`lm_uw_arena_<地點>`），並把黑檀之夜、榮譽洞、月下拍賣會搬進去。要排在 `work26.py`、`lust_s8.py` 之後（它們會重寫地標）。可以重跑 |
| `club_lines42.py` | `data/rules/stories.json`、`data/world/npcs.json`、`landmarks.json`、`special_maps.json`、`data/worldbook/elondia.worldbook.json` | 特殊區域的延伸線：貝爾維婭、艾蜜莉亞走進黑檀之夜，瑟蕾娜、克拉拉走進榮譽洞（各一個任務，完成後那個地標多兩個場景）；炎華南域的新角色蘇婉貞（四個任務）與龍安府瓦舍的「無面樓」（地標、內部、場景），純愛線在御街夜市多一個場景。要排在 `east_p3_places.py`、`east_p3_npcs.py`、`east_p4e_group.py`、`east_p7_people.py`、`east_p9_work.py`、`underworld39.py` 之後（它們會整筆重寫地標、南域的 NPC 或場景）。可以重跑 |
| `bondage44.py` | `data/rules/gear.json`、`items.json`、`shops.json`、`data/world/special_maps.json` | 拘束具擴充（[LEWD_STATS](../../../docs/LEWD_STATS.md) 第 7.1 節）：42 種拘束具與調教道具的底材、47 件店貨（鎖鏈有長短款）；原本的拘束具改標籤（基礎款兩邊賣、其他只在成人用品店）；內建店種 `adult_shop`「成人用品店」擺進每條地下街；原本的店上架的拘束具件數調少。要排在 `lust_s9.py`、`underworld39.py` 之後（它們會重寫拘束具、商店件數與地下街）。可以重跑 |
| `cursed45.py` | `data/rules/gear.json`、`items.json`、`lewd.json`、`travel_events.json` | 詛咒具（第 7.2 節）：13 種底材與物品（`gear.curse`）、地下城寶箱的機率、神殿解咒（`unbind.uncurse`）、4 件地下城陷阱事件與 2 件城鎮事件。要排在 `bondage44.py` 之後。可以重跑 |
| `toys46.py` | `data/rules/items.json`、`family.json` | 成人用品店的調教家具、戰鬥消耗品與道具（第 7.3 節），吸乳器（`lactation.milk.tool`）。要排在 `cursed45.py` 之後。可以重跑 |
| `outfits47.py` | `data/rules/gear.json`、`items.json` | 42 種成人向服裝底材、126 件店貨；成人向服裝改成只在成人用品店賣；布料服裝的防禦（[ITEMS](../../../docs/ITEMS.md) 第 2 節）。要排在建立服裝底材的腳本（`lust_s9.py`、`east_p5_items.py`、`east_p6_gear.py`）與 `toys46.py` 之後；重跑那些腳本之後也要再跑這個。可以重跑 |
| `park_experience48.py` | `data/rules/gear.json`、`items.json`、`data/world/special_maps.json`、`landmarks.json` | 緋夢樂園的主題體驗區（[LUST_PARK](../../../docs/LUST_PARK.md) 第 9 節）：入口廣場的閘門、體驗區入口、五座體驗館與它們的第二層（配種舍、著床室、飼育區、花園深處、後台）的特殊地圖、館的地標與 57 個場景（場景的身分 `role`、淫植花園的進場條件 `enter`），新底材牛尾腰飾與三件店貨。要排在 `outfits47.py`、`underworld39.py`、`club_lines42.py` 之後（它們會重寫服裝與地標）。可以重跑 |
| `park_outfits49.py` | `data/rules/gear.json`、`items.json`、`shops.json`、`enemies.json` | 主題體驗區的五件套服裝（每館一套）、乳牛比基尼拆成上衣與下著、每館一間換衣間（`costume_<館>`）、人馬族版的下身與蹄具（`wear_as`）、各園區層主掉落套裝（[LUST_PARK](../../../docs/LUST_PARK.md) 第 9 節）；排在 `park_experience48.py` 之後 |
| `parasite_lures51.py` | `data/rules/travel_events.json`、`items.json` | 寄生物的取得（[ADULT_EVENTS](../../../docs/ADULT_EVENTS.md) 第 6 節）：帶來寄生物的四件地下城事件各加一件陽剛體型的版本（`dg_<id>_m`，結構與效果從原本的事件複製、只換文字，接在原本的後面），黑市賣的三件寄生物引子（`use.lure`，接在「馴服的魔導衣」後面）。要排在 `dungeon_events24.py`、`parasites25.py` 之後。可以重跑 |
| `club_lines43.py` | `data/rules/stories.json`、`data/world/landmarks.json` | 特殊區域的延伸線・第二批：卡蓮、朧（黑檀之夜），卡蜜拉、零號（榮譽洞），赤鬟、烏日娜、海蘭（野馬帳），沈知瀾、瑤汀（無面樓），各一個任務與她們的場景。要排在 `club_lines42.py` 之後（它建立無面樓）。可以重跑 |
| `rep_balance56.py` | `data/rules/stories.json` | 勢力聲望的補強：河谷鎮（人類諸國聯盟）與大燁朝廷的任務結局給自己勢力的聲望（逐條列在 `RIVERVALE`、`YANYE` 兩張表，表上寫的是最後的數字，同勢力原本的聲望換掉）。站在對方那邊的選擇、已經寫了聲望（偏金墨盟、扣大燁）的結局不給。要排在所有寫 stories.json 的腳本之後。可以重跑 |
| `docgear24.py` | `docs/ITEMS.md` 3.1.1 節 | 任務的獨特裝備表 |
| `../../tools/flowdoc/flowdoc.py` | `worldgen/design/ElondiaQuestFlows.html` | 任務線走向（上面任何一個改過之後都要重跑） |
| `../../tools/guide/guide.py` | `docs/guide/` | 給玩家的遊戲攻略，同步到 wiki（`data/` 改過之後都要重跑；沒重跑時測試 `guide.spec.ts` 會失敗） |

建議的順序：`uniq23.py` → `dungeon_events24.py` → `parasites25.py` → `town_events26.py` → `work26.py` → `npc_looks27.py` → `lust_park_s7.py` → `lust_s8.py` → `lust_s9.py` → `high_gear31.py` → `high_dungeons31.py` → `material_drops31.py` → `lust_s10.py` → `underworld39.py` → `bondage44.py` → `cursed45.py` → `toys46.py` → `npc_looks40.py` → `club_lines42.py` → `club_lines43.py` → `outfits47.py` → `park_experience48.py` → `parasite_lures51.py` → `story_batch1.py` → `yulin_body32.py` → `rep_balance56.py` → `docgear24.py` → `flowdoc.py` → `guide.py`。

## 一次性（已經套用過，留作紀錄）

其他腳本是當初做資料轉換、平衡調整、合併分支用的，已經套用在目前的資料上。多半不能直接重跑（會重複套用、或依賴當時的檔案狀態），要參考做法時再讀：

- 角色與 NPC：`gen_npcs.py`、`gen_stories.py`（elondia-plus 世界包的草稿）、`merge_npcs.py`（併進內建 npcs.json，`npcs.before.json` 是當時的底）、`npc_stages_b1.py`、`add_part2.py`、`npcfmt.py`、`rooms23.py`、`npc_noattack24.py`
- 地標與特殊地圖：`landmarks23.py`、`interiors23.py`（`special_maps.base.json` 是當時的底）、`lm.py`、`links.py`、`tent_entry55.py`（金帳、宣德樓、珠船塢接到有任務點的特殊地圖，只在有任務點在裡面時開放；要排在 `landmarks23.py` 之後）
- 怪物與平衡：`abyss.py`、`abyss_items.py`、`build_abyss.py`、`doc_abyss.py`、`mkboss23.py`（`boss23.json`）、`story_enemies.py`、`boss_rounds.py`、`bossedit.py`、`tune*.py`、`assign_ult.py`、`levels.py`、`add_skills.py`
- 合併分支：`port_p209_gear.py`、`port_p209_text.py`
- 其他：`events.py`（主人事件）、`lore_update.py`、`wb.py`（世界書）、`ed*.py`、`e1.py`、`fsum.py`、`msum.py`、`ml.py`、`short.py`、`story_groups.json`
