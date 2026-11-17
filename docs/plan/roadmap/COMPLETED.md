# 已完成

> 上層：[計畫與追蹤](../README.md)。做完的計畫在這裡記一段：做了什麼、規則寫在哪份系統文件。細節以系統文件為準，這裡只是索引。新的紀錄加在最上面。

### 2026-11-17 房子的擴建（R32 的 X2）

- 加蓋一層、挖地下室、院子擴大一格；原本的樓層不重新生成，施工期間新的部分走不過去，完工時通知。
- 規則寫在 [HOMES](../../HOMES.md) 第 3.1 節；和計畫不同的地方見 [HOME_EXPANSION_PLAN](HOME_EXPANSION_PLAN.md) 第 10 節。

### 2026-11-17 房子的擴充：舒適度分段、成套家具、熟成桶（R32 的 X1、X4、X5）

- 舒適度分三段（睡得香甜、精神飽滿、神采奕奕）；成套家具四套，湊齊加舒適度與長休狀態，新家具六件；熟成桶三種，熟成五種東西，新物品四件。
- 規則寫在 [HOMES](../../HOMES.md) 第 4、4.1、6.1 節；和計畫不同的地方見 [HOME_EXPANSION_PLAN](HOME_EXPANSION_PLAN.md) 第 10 節。X2、X3、X6、X7 還沒做，留在 ROADMAP R32。

### 2026-11-17 家僕的事件（R31 的 H6）；R31 完成

- 家裡的事（`scope: home`）：有家僕時在家走動、在家長休醒來依機率遇到，事件裡代入一位符合條件的家僕；和城鎮事件共用事件視窗。
- 內建 10 件（一般 6 件、成人向 4 件），新的效果：家僕請假、家僕的工錢、收起一件裝飾家具；世界編輯器可以新增家裡的事，「⚙️ 事件設定」多了家裡的事的機率。
- 規則寫在 [HOMES](../../HOMES.md) 第 8.1 節；和計畫不同的地方見 [HOUSEHOLD_STAFF_PLAN](HOUSEHOLD_STAFF_PLAN.md) 第 12 節。

### 2026-11-16 雇用家僕（R31 的 H1～H5）

- 起因：盤點房屋系統時規劃（2026-11-11），R30 儲物箱做完後接著做。
- 女僕（舒適度）、廚師（在家長休後的早餐）、園丁（每天收成進箱子、重新播種）、管家（上限 +1、從保險箱付工錢、提醒）；應徵者每 7 天一批；工錢欠著回家結清，欠超過 7 天辭職；解雇先結清。
- 新的主動行動「請他來家裡做事」（認識的普通人）；自己的奴隸留在家裡時可以分派家務；在家行動時交給 AI 的場景帶上家裡的僕人；內容頁籤「⚙️ 房屋設定」。
- 規則寫在 [HOMES](../../HOMES.md) 第 8 節；和計畫不同的地方見 [HOUSEHOLD_STAFF_PLAN](HOUSEHOLD_STAFF_PLAN.md) 第 11 節。H6 家僕的事件還沒做，留在 ROADMAP R31。

### 2026-11-16 房子的儲物箱（R30）；R30 完成

- 起因：盤點房屋系統時發現房子不能存放東西（2026-11-11 規劃）。
- 家具多了「儲物」功能：木箱、衣櫃、鐵皮櫃、地窖貨架、保險箱，容量算種類；保險箱可以存錢，戰敗不扣。
- 在自己的房子裡做工藝（配方、打造、自創配方）、播種時，箱子裡的材料、工具與種子也算；交給 AI 的場景帶上箱子裡收著的東西。
- 規則寫在 [HOMES](../../HOMES.md) 第 7 節，[CRAFTING](../../CRAFTING.md) 第 6 節；設計紀錄與和計畫不同的地方見 [STORAGE_PLAN](STORAGE_PLAN.md) 第 7 節。

### 2026-11-10～12 拘束具與淫具的擴充（點子 I30，Discord 回饋）

- 起因：玩家希望拘束具和淫具的欄位更完整、道具更多。
- 欄位：額外飾品欄從一格變成存檔規則（0～8 格，預設 2），任何部位的拘束具都能放；放在這裡時附魔、材料特性、正的屬性與檢定加值不生效，減值、慾望指標、拘束照算。
- 道具：42 種拘束具與調教道具、13 種詛咒具、調教家具與消耗品、42 種成人向服裝；地下街多了成人用品店；拘束具可以委託或自己打造，還能加一項慾望指標；修了流派、上鎖的拘束具的戰鬥增益有全身上限。
- 規則寫在 [LEWD_STATS](../../LEWD_STATS.md) 第 7 節（7.1～7.3）、第 25 節，[ITEMS](../../ITEMS.md) 第 2 節；CHANGELOG v0.6.1、v0.6.2。沒做的「防具＋拘束具的淫器合煉」留在點子庫 I24。

### 2026-11-10 懷孕、嬰兒、泌乳與怪物的苗床（成人向，R28）；R28 完成

- P1～P5：受孕判定（性經歷的 AI 記錄時）、40 天的孕期與階段、察覺劇情、生產、嬰兒（神殿的育幼院或自己的房子）、泌乳與道具、雙面效應、形象圖、內容編輯器（事件、條件與效果、物品／刺青／寄生物的欄位、懷孕與泌乳設定）。
- P6 怪物的苗床：卵生、胎生、寄生（屬於寄生物）；戰敗留下、戰鬥中被植入、成長、產下、取出、稱號、編輯器。內容篩選「懷孕」「泌乳」「怪物的苗床」預設都關。
- 規則寫在 [FAMILY](../../FAMILY.md)；設計紀錄留在 [PREGNANCY_PLAN](PREGNANCY_PLAN.md)（其他計畫引用第 11 節）。這一版不做的延伸搬到點子庫 I32。

### 2026-11-08 被主人帶著時向主人提議去地下街（R27）；R27 完成

- 起因：玩家問奴隸存檔怎麼進阿爾貝納的黑市。被主人帶著時酒館的「打聽地下街／走進地下街」整個不出現，是最早的奴隸系統（主人是隊長、奴隸在旁邊看）和「黑市只有奴隸買賣」留下的限制。
- 酒館多一項「向主人提議去地下街」（主動行動 `propose`、`target = underworld`），成功時主人當天帶你去、你也記住入口；部分成功只帶你去；失敗當天不再提。主人身分的修正在 `slavery.json` 的 `propose.tag_dc.underworld`。
- 進去之後的限制照舊（黑市的奴隸向主人提議買下、珍品不能自己買、淫鬥場不能報名），之後要放寬再另外決定。
- 規則寫在 [COMPANIONS](../../COMPANIONS.md)「向主人提議去地下街」與 [SPECIAL_MAPS](../../SPECIAL_MAPS.md) 第 9 節，測試在 `proposeUnderworld.spec.ts`。

### 2026-11-06 新職業武夫、仙術師；世界管理的職業編輯器（點子庫 I29）

- 擁有者的決定（I29 評估之後）：新增武夫、仙術師，**給 NPC**；做職業編輯器，也能調 NPC 生成的倍率；存檔用到找不到的職業時**直接讀取失敗**，不換成別的職業。
- 武夫參考戰士與武僧（27 個技能，一部分換皮、一部分原創），仙術師參考法師與吟遊詩人（29 個新的戲法、法術與技能，另外開放 8 個現有法術）。兩個職業 2～20 級每一級都至少有 6 個能力（能重抽），新的狀態 4 個。NPC 相關資料（身分標籤的職業倍率、血統、店主、戰敗事件的起意者、奴隸身價、法師解構、特質的 NPC 職業）都補上。沒做的：這兩個職業的獨特裝備、固定 NPC。
- 職業編輯器（`classMods.ts`、`ClassEditor.vue`）：定義、裝備模板、NPC 權重（`npc_weight`，新欄位）與身分標籤的職業倍率合成一份；能學的能力在職業頁批次勾選。`combatClasses` 改成套用世界時重算；NPC 抽職業改用 `pickNpcClass`（權重都一樣時和以前一樣平均抽）。局部匯入、匯出還不帶職業。
- 舊存檔的一次性調整（擁有者後來要求）：讀檔時炎華之地的冒險者裡新職業太少，就在事件視窗問玩家要不要改一批還沒打過交道的人（`classRebalance.ts`，只問一次）。
- 規則寫在 [CONTENT_EDITOR](../../CONTENT_EDITOR.md) 3.45 節、[CONTENT_DEPENDENCIES](../../CONTENT_DEPENDENCIES.md) 第 2、5 節、[NPC_SYSTEM](../../NPC_SYSTEM.md) 第 1 節、[ITEMS](../../ITEMS.md) 2.2 節、[COMBAT_SYSTEM](../../COMBAT_SYSTEM.md) 第 9 節；內容檔的格式在 `worldgen/guides/abilities.md` 1.2 節。測試在 `classMods.spec.ts` 與世界編輯器的來回測試。

### 2026-11-06 炎華之地的打工、巡禮與祭典（成人向，R26）；R26 完成

- 中央平原有 17 條打工、巡禮、祭典的任務線，炎華之地原本一條都沒有。照同樣的規格做了 10 條、32 個任務：
  - 打工 5 條：狀元客舍的紅袖添香、運河畫舫的船娘、瑔州港的采珠女、大車店的燒炕丫頭、茶馬市的通譯。
  - 巡禮 1 條：龍母祠的求子香（五站，香頭跟著香路換城）。
  - 祭典 4 條：上元夜的龍珠、乞巧節的織女、狐嫁女、那達慕的彩頭。
- 另外有 10 位委託人（成人向的固定 NPC）、4 個新地標與 10 個上工的場景、10 件獨特裝備、10 個獨特技能與技能書，新底材肚兜、紅蓋頭、褻褲，世界書的龍母祠。
- 擁有者的決定：照計畫全部做，先做打工。人馬族對象只寫在選項文字（「（人馬族，人外）」），不加內容篩選。那達慕的賽馬分人馬族與非人馬族兩個版本的任務點。等級照中央平原的 6～13。
- 做的時候和計畫不同的地方：
  - 采珠女的制服改成裹胸：束胸綢是拘束具。
  - 通譯的獎勵改成耳墜：沒有舌頭的穿孔底材。
  - 十個技能都只用現有的戰鬥規則，沒有改程式；例如紅袖添香是「+1d4、激勵」，不是必定命中。
  - 新地標是一般的地標，平常可以參訪、打工。
  - 制服只用上身、頭、上半身的內衣，人馬族的主角也接得到；褻褲（內褲那一格）不當制服。
- 規則寫在 [ADULT_EVENTS](../../ADULT_EVENTS.md) 第 8 節與 [LEWD_STATS](../../LEWD_STATS.md) 第 11 節。產生腳本 `east_p9_work.py`、`east_p9_fest.py`（可以重跑）。測試在 `adultScenes.spec.ts`（含人馬族的制服與那達慕的兩個版本）、`lewdUnique.spec.ts`、`eastContinent.spec.ts`。計畫檔 EAST_ADULT_WORK_PLAN 刪掉。

### 2026-11-06 材料資訊：分段、等級與用途（R24）；R24 完成

- 依 2026-11-05 Discord 第二輪玩家回饋（Tirpitz：材料數不清、看不出幾級、能做什麼）。新模組 `materialInfo.ts`：
  - 材料等級：手動 → 打造 → 配方 → 掉落的怪物等級換算。換算照各級材料的建議等級，不另訂表；這是計畫裡留下的待決定第 1 項。
  - 用途說明：可打造、可以做的配方、輔料偏向。
  - 依用途分段：打造材料照貿易類別、配方原料照工藝、其他照貿易類別。
  - 反查索引只在內容或存檔的自創配方換過時重建。
- 待決定第 2 項（怪物素材再細分）沒做：行囊裡同一段照等級排序，實際遊玩覺得還是太長再說。
- 行囊、商店的「你的行囊」、世界編輯器的「材料等級」。規則寫在 [ITEMS](../../ITEMS.md) 4.6 節與 [CONTENT_EDITOR](../../CONTENT_EDITOR.md)，測試在 `materialInfo.spec.ts`。計畫檔 MATERIALS_PLAN 刪掉。

### 2026-11-06 小改進（第二輪）：委託板、規則判定提醒、擲骰的加值拆解（R25）；R25 完成

- 依 2026-11-05 Discord 第二輪玩家回饋（Tirpitz）做的三項：
  - 委託板的篩選與排序（`questBoard.ts`）：規則寫在 [GUILD](../../GUILD.md) 第 0 節。
  - 自由行動在規則判定時的提醒：規則不改，固定用魅力；寫在 [ACTIONS](../../ACTIONS.md) 第 3 節。
  - 擲骰的加值拆解：時間軸 roll 的 `natural`、`parts`、`dc_parts`（`rollParts.ts`，約 20 處擲骰），日誌「經過」與戰鬥紀錄滑鼠移上去或點一下看；寫在 [ACTIONS](../../ACTIONS.md) 第 6 節與 [COMBAT_SYSTEM](../../COMBAT_SYSTEM.md) 8.3 節。舊存檔不顯示。
- 測試在 `questBoard.spec.ts`、`rollParts.spec.ts`。計畫檔 QOL2_PLAN 刪掉。

### 2026-11-06 高等地下城的寶箱與材料委託（R12 的剩餘部分）；R12 完成

- 寶箱：`gear.json` 的 `chest_forge_high`，寶箱等級到 13、17 時取代那一層的打造材料（Lv.13～16：第 4～6 級；Lv.17～20：第 5～7 級；原本深層只有第 3、4 級）。`gear.ts` 的 `chestForgeTable`；物品來源也列出來。
- 委託：新的材料委託「層主的打造材料」（`drop_boss`，第 4 級以上、依層主等級 F～S、1～2 份），材料價值 × 1.25（擁有者決定，其他材料委託照舊 × 1.5）；層主一層只有一隻，不另外補戰鬥點。
- 擁有者的決定：新稀有度與附魔上限不做，連同工藝升級的速度移到 R1。
- 規則寫在 [DUNGEON_DESIGN](../../DUNGEON_DESIGN.md) 第 8 節與 [GUILD](../../GUILD.md) 第 1 節，測試在 `materialQuests.spec.ts`。計畫檔 HIGH_DUNGEONS_PLAN 刪掉（地下城本身的紀錄在 2026-10-31 那一段）。

### 2026-11-06 角色線：白百合巡禮、全城跑最快的精靈（R9）；R9 完成

- 白百合巡禮（奧菈莉婭＆格溫德琳，`pil_`）、全城跑最快的精靈（琥珀，`amb_`）各四個任務：一～三 Lv.5／8／11、D／C／B 非成人向，四成人向（三的結局旗標、好感 40）。
- 擁有者的決定：白百合的結局一定三人一起（接受任命或放下頭銜，小隊一起入隊）；琥珀的「去霧谷」只給揭開迷霧結界的玩家（`fog_lifted`）；審問官不和瓦倫汀・克雷連在一起。
- 新增捕奴隊的打手（Lv.5）、頭目「灰狗」（Lv.13，實測勝率 97%、贏的場次剩 69%）、獨特飾品霧銀耳墜；三人設成 `no_attack`、加上結局之後的 `stages`，琥珀補了成人向外貌。
- 產生腳本 `worldgen/scripts/elondia/char_lines38.py`（可以重跑）；內容寫在 [elondia-storylines](../../../worldgen/design/elondia-storylines.md) 第 5 節第三十八批。`story_batch1.py` 已經不能重跑（會蓋掉後來直接寫進 stories.json 的任務與時段），腳本的 README 註明了。計畫檔 CHARACTER_LINES_PLAN 刪掉。

### 2026-11-06 事件的時段（R13 的剩餘部分）；R13 完成

- 事件範本多了 `hours`（`day`／`night`）：城鎮、地下城、寄生物事件時段不對時不會抽到（`townCandidates`、`dungeonCandidates`、`parasiteCandidates`）；旅途、線索事件不看。世界編輯器的事件頁可以選時段。
- 內建 9 個寫著「今晚」「半夜」「夜市」的城鎮事件設成只在夜裡（熱鬧的晚上、賭局的代價、被搭訕、舞孃缺人、頭牌的邀請、夜市的扒手、畫皮的書生、牡丹開的夜、敲門的綿羊精）。貴族沙龍的邀請、冒險者之間的切磋、黑市的耳語是白天也說得通的「邀約」，不限；地下城、寄生物的夜裡事件在長休之後觸發，沒有設。
- 規則寫在 [TRAVEL_EVENTS](../../TRAVEL_EVENTS.md) 第 6 節與 [guides/events](../../../worldgen/guides/events.md)，測試在 `townEvents.spec.ts`。特殊任務的開頭不限時段（盤點時沒有需要的），不做。計畫檔 STORY_TIME_PLAN 與盤點檔 `story_time_audit.json` 刪掉。

### 2026-11-06 工藝規則（R21：K4 檢定公式、K5 0 級規則與學費、K6 圖紙）；R21 完成

- 擁有者確認數值後照建議做；製革與裁縫照擁有者的決定**不合併**（原 K3）。
- K4：工藝檢定改成 d20 + 工藝等級 × 2 + 屬性調整值 ÷ 3（不加熟練），委託打造由店主擲；DC = 等級 × 2 + 5（打造 7～19、配方 7～15）。行動設定的 `craftCheck`。
- K5：新角色、第一次入隊的同伴工藝從 0 級開始，工匠身分那一門 Lv.2（`startCrafts`）；舊存檔算 Lv.1；學工藝（`craftLessons.ts`）：0→1 200 白鸛 8 小時、1→2 800 白鸛 24 小時，店裡最多教到 Lv.2，在受訓面板。
- K6：圖紙（`blueprints.ts`）：每個底材一張、記在存檔的 `blueprints`；自己打造沒有圖紙 DC +5；價格 = 底材 × 1.5，鐵匠鋪、裁縫店、珠寶店每天上架 3～5 張，寶箱 3～8%、人形敵人 2%；效果 `blueprint`；打造畫面與行囊顯示。
- 規則寫在 [CRAFTING](../../CRAFTING.md) 1.1、2.2 節與 [ITEMS](../../ITEMS.md) 第 5 節，測試在 `craftLessons.spec.ts`、`blueprints.spec.ts` 與工藝相關的測試。計畫檔 CRAFTING_PLAN 整份做完，刪掉；沒決定的延伸放在點子庫 [I28](../ideas/dev-discussion.md#i28)。

### 2026-11-06 受訓的價格與門檻（R20 的 C4）；R20 檢定與特質全部完成

- `perks.json` 的 `training`：學費 = 強度 × 400、時數 = 強度 × 8（每天練 8 小時，分天）、DC = 12 + ⌊強度⌋；克服缺陷學費與時數打對折、沒有門檻；強度 3 以上要 Lv.3，4 以上要 Lv.5 而且店主或老師的親密度 20。內建特質的 `train` 拿掉寫死的學費、時數、DC，改照公式（`perks.ts` 的 `trainSpec`、`trainDays`）；特質可以另外寫。
- 介面：受訓面板寫出天數與門檻；特質編輯器的學費、時數、DC 空白照公式（寫出公式的值）。規則寫在 [PERKS](../../PERKS.md) 4.2 節，測試在 `trainC4.spec.ts`。
- R20（檢定分類、特質整併、身分標籤編輯器、新身分、受訓、創角版面）全部完成，刪掉計畫檔 CHECKS_PERKS_PLAN；工匠開局 Lv.2、NPC 帶工匠身分與工藝移到 R21（當時的 CRAFTING_PLAN 第 3 節）。

### 2026-11-05 新的身分標籤（R20 的 C3）

- `npc_tags.json`：15 個新身分（職業：獵人、農民、漁夫、水手、傭兵、學者、藝人；工匠：鐵匠、木匠、皮匠、珠寶匠、煉金術士、廚師；地下：盜賊、走私客），加成寫在檢定分類上；標籤多了 `group`（分組）、`craft`（工匠的工藝）；主角效果多了 `fare_mult`（水手的海路船資 −20%）與 `start_items`（開局帶的物品）。
- 引擎：`state.ts` 開新遊戲時帶上身分的物品；`road.ts`、旅行畫面的船資乘上 `fare_mult`。介面：創角的選擇器照分組排，世界管理的身分標籤可以改分組、工藝、船資與開局物品。
- NPC 還不會隨機抽到新身分；工匠開局工藝 Lv.2 等 R21。規則寫在 [NPC_SYSTEM](../../NPC_SYSTEM.md) 4.1 節，測試在 `pcTagsC3.spec.ts`。

### 2026-11-05 世界管理的身分標籤（R20 的 C6）

- 引擎：`npcTagMods.ts`（`sanitizeNpcTagMod`、`editableOf`、`mergeNpcTag`、`npcTagUsage`）；`ContentMods.npcTags`，套用時最先；內建世界的匯出帶上可以編輯的欄位。
- 介面：「🧬 角色」組的「🏷️ 身分標籤」頁籤（`NpcTagEditor.vue`）：基本、NPC 怎麼生成、主角帶著時的效果；內建標籤寫死的效果保留、不開放編輯。
- 規則寫在 [CONTENT_EDITOR](../../CONTENT_EDITOR.md) 3.65 節，測試在 `npcTagMods.spec.ts` 與世界編輯器的來回測試。

### 2026-11-05 特質整併（R20 的 C2）

- `perks.json`：20 個特質、6 個缺陷的檢定加值改寫在檢定分類上（例如謊話連篇：欺瞞 +3、能言善道：說服 +2、交易 +1、識途老馬：求生 +2），描述一起改；幸運兒移到「其他」、老練冒險者移到「探索與潛行」。
- `npc_tags.json`：身分標籤的加成換成分類（旅人：求生 +2、商人：交易 +2、貴族等：對特定對象的說服、魅惑）。
- 強度：一個分類的廣度照涵蓋的行動與情境加總、夾在 1～2（`perks.ts` 的 `skillBreadth`）。
- 文件：[PERKS](../../PERKS.md) 第 3 節、[NPC_SYSTEM](../../NPC_SYSTEM.md) 4.1 節。存檔不用遷移（特質的 id 不變，效果每次從資料讀）。

### 2026-11-05 檢定分類（R20 的 C1）

- 資料：`actions.json` 的 `skills`（13 個分類）、各行動的 `skill`、`context_skills`。
- 引擎：檢定篩選多了 `skills`（`perks.ts` 的 `checkSkills`、`matches`，強度算 1）；自由行動先替每個分類算好多出來的修正（`ActionPending.skillMods`），AI 判定時選 `skill`；城門盤查在說服、欺瞞、潛行裡挑總值最高的；報告的 `check.skill`。
- 介面：等待判定的卡片與日誌寫「說服檢定」；特質編輯器、獨特裝備的檢定加值、創角的自訂特質可以選分類。
- 規則寫在 [ACTIONS](../../ACTIONS.md) 2.1 節，測試在 `skills.spec.ts`。特質本身的效果還沒改（C2）。

### 2026-11-06 真空與慾望指標下跌的存檔規則（點子庫 I26）

- 真空：外衣底下沒穿內衣或內褲、外面那件會走光時，那一側曝露度 +1；底材多了 `vacuum`（內建 10 件，`worldgen/scripts/elondia/vacuum37.py`）；在城裡真空的日子淫亂 +1。規則寫在 [LEWD_STATS](../../LEWD_STATS.md) 第 3、4 節。
- 存檔規則「曝露名聲每天淡掉多少」「順從每次回落多少」「淫亂每次回落多少」（每次幾點，0～10 的整數，頻率不變），「經驗值倍率」改成 0.1～5（[SAVES](../../SAVES.md) 第 7 節）。
- 沒做的延伸（不准穿內衣褲的條款、盤查時被發現）記成點子庫 I27。

### 2026-11-05 基本價格依據表（R19 的 T7）；R19 貿易全部完成

- [基本價格依據表](../../../worldgen/balance/prices.md)：以世界書的舊幣制與一般人一天 15 白鸛的生活費為錨，對照 14～15 世紀英格蘭的物價（1 便士 ≈ 5 白鸛），逐列寫出武器、防具底材、糧食、日用品、打造材料的現價、依據與處理。
- 調整的離群值（`gear.json` 底材，`items.json` 的制式裝備照公式一起更新 45 件，手寫價格的獨特裝備不動）：匕首 160 → 60、長戟 380 → 220（玩家回報的「長兵器比劍貴」）、長弓 300 → 150、皮靴 20 → 40、布腰帶 25 → 10。
- R19 的計畫（TRADE_PLAN）整份做完，刪掉；規則都在 [TRADE](../../TRADE.md) 第 3～5 節。沒決定要不要做的延伸（事件改變行情、世界編輯器編輯標籤與狀態）放在點子庫 [I25](../ideas/dev-discussion.md#i25)。

### 2026-11-05 跑商的限制與平衡模擬（R19 的 T6）

- 收購遞減：存檔規則 `sellGlutPct`（預設 3%）、`market.json` 的 `sell_glut`（最多 50%、每天回復 5 件）、存檔的 `sales`；`trade.ts` 的 `glutCount`、`glutMult`、`sellTotalOf`，購物車與直接賣出都照遞減算並記錄。
- 介面：購物車賣出的小計寫「▼遞減」，行囊的收購價旁寫「收多了 −N%」，價格拆解多一步。
- 商店庫存：照現有的每日存貨，沒有另外加上限（原計畫第 11 節的待決定事項）。
- 平衡模擬：`src/__tests__/tradeSim.spec.ts`，結果 [trade-sim](../../../worldgen/balance/trade-sim.md)。規則寫在 [TRADE](../../TRADE.md) 3.4 節。

### 2026-11-05 價格拆解（R19 的 T5）

- 引擎：`trade.ts` 的 `buyBreakdown`、`sellBreakdown`、`breakdownText`；一般商品記下定價依據（`Deal.basis`：目錄價、店家加成）。
- 介面：`PriceSteps.vue`，商店清單點開一列、行囊點收購價展開；價格上滑過去也看得到。
- 規則寫在 [TRADE](../../TRADE.md) 3.3 節，測試在 `market.spec.ts`。

### 2026-11-05 動態狀態庫（R19 的 T4）

- 資料：`data/rules/market.json` 的 `states`（38 個：商路不安全、豐收、歉收、瘟疫、慶典、戰事、礦坑塌方、商隊抵達……）與 `state_rules`（每 7 天一期、最多 2 個）。
- 引擎：`market.ts` 的 `townStates`（種子 + 聚落 + 第幾期決定，不存檔）；`categoryMult` 把狀態和固定標籤一起相乘。
- 介面：行情列與 ▼／▲ 的說明寫出狀態與剩幾天；打聽、聊天與 AI 準備商店清單的提示詞帶上狀態。
- 規則寫在 [TRADE](../../TRADE.md) 3.2 節，測試在 `market.spec.ts`。

### 2026-11-05 貿易類別與城鎮的固定標籤（R19 的 T2、T3）

- 資料：`data/rules/market.json`（14 個貿易類別、15 個固定標籤、倍率夾在 0.4～2.5）；`geography.json` 的聚落都貼上 1～3 個 `trade_tags`；`items.json` 推不出來的 28 件手寫 `trade_category`。
- 引擎：`market.ts` 的 `tradeCategory`、`inferTradeCategory`（照底材、打造材料、怪物掉落、物品類別推）、`categoryMult`、`marketMult`；`trade.ts` 的 `itemDeal`（售價）與 `sellPrice`（收購價）乘上類別倍率。打聽、聊天的 `<world_facts>` 多一行「這裡的行情」。
- 介面：商店視窗上方的「某某的行情」（`MarketTags.vue`，城門的地點面板也有）、商品與收購價旁的 ▼／▲（`MarketBadge.vue`）；內容編輯器的物品多了「貿易類別」。
- 規則寫在 [TRADE](../../TRADE.md) 3.1 節，測試在 `market.spec.ts`。

### 2026-11-05 購物車與整車交涉（R19 的 T1，含原 B21）

- 擁有者看過樣稿（`docs/mockups/trade.html`）後決定先做這項；同時定了 R19 其他的數值（動態狀態每 7 天、最多 2 個；倍率 ×0.4～×2.5；收購遞減每件 −3%、做成存檔規則、最多 −50%；交涉的賣出部分除以倍率），寫在當時的 TRADE_PLAN 第 2 節（R19 做完後刪掉，規則見 [TRADE](../../TRADE.md)）。
- 引擎：`trade.ts` 的 `Cart`、`cartQuote`、`checkoutCart`、`bargainNet`、`settleNet`、`cartBargainTarget`；`ShopState.cartBargain` 記今天的整車交涉；`bargainSetup`、`applyBargain` 多了出價（`ActionPending.offer_cc`），判定的提示詞寫「想付／想收」。
- 介面：`ShopDialog.vue` 一般商品與行囊改成加進購物車，`CartPanel.vue`（電腦版在兩欄下面，手機版是第三個分頁）。
- 原 B21（交涉的成交價不是喊的價）：成交價取出價與能談到的最好價中對店家有利的那個。規則寫在 [TRADE](../../TRADE.md) 4.1、第 5 節，測試在 `cart.spec.ts`。

### 2026-11-05 依配方製作與自創配方的介面、配方材料當場補買

- 接著 R18：擁有者看過樣稿（`docs/mockups/recipes.html`）後決定照做，配方材料也能當場補買；自創配方的類別規則不放寬。
- `RecipePanel.vue`：工藝、類別按鈕列、只看做得出來的、搜尋、配方卡片、詳細區（批數按鈕、材料表、補買）；`InventPanel.vue`：工藝（寫出能自創的類別）、類別、配方等級改成按鈕。
- 引擎：`recipes.ts` 的 `recipePlan` 加 `buy`（`inputs` 帶 `offer`、`buy`，`buys`、`buyCost`），target 接 `|!buy`；補買和打造共用 `craft.ts` 的 `buyHere`。
- 規則寫在 [CRAFTING](../../CRAFTING.md) 第 6、7 節；測試在 `craftMaterials.spec.ts`。

### 2026-11-05 工藝介面與材料（R18）

- 起因：玩家回饋（Discord 的 Tirpitz、issue #62 第 14、15 條）：底材清單混雜難找、看不出做出來的數值、「一級材料為啥非要自己買」。
- 樣稿 `docs/mockups/craft.html` 確認後實作（`CraftPanel.vue`，委託與自己打造共用）：部位 → 類型 → 底材按鈕列、搜尋、材料比較表（做樣稿時確認稀有度不改數值、只決定附魔點數）、記住上次的選擇。
- 底材的類型：`gear.json` 主手、副手的底材加 `type`，其他依欄位與材料推（`gear.ts` 的 `baseType`）；世界編輯器可以改（`mods.ts` 的 `sanitizeBase`）。
- 第 1 級材料改成物品（擁有者決定）：鐵礦石、木材加上 `forge` 並在店裡賣，新增鞣製皮革、亞麻布、銅錠，低階獸皮、羊毛、古代亞麻布、燒焦的銅料也能用；拿掉 `crafts.json` 的 `self.tier1_cost_ratio`。委託的第 1 級照舊由工匠提供。
- 材料來源：`craftPlan` 的 `sources`、選項 `use`（優先用哪一種）與 `buy`（向站的這間店當場補買，`shopOfferHere`、結算時扣存貨）；target 接 `|!use=`、`|!buy`。輔料照舊。
- 規則寫在 [CRAFTING](../../CRAFTING.md) 2、2.1 節、[ITEMS](../../ITEMS.md) 第 5、5.1 節、[CONTENT_EDITOR](../../CONTENT_EDITOR.md)；測試在 `craftMaterials.spec.ts`、`crafting.spec.ts`、`gear.spec.ts`。

### 2026-11-05 提示詞與正則（R17 結案）

- 起因：玩家用自訂破限預設（「貓神」）時，模型在正文寫出 `<think_nya>…</think_nya>`，原樣顯示在冒險日誌（Discord，2026-11-05）。
- 頁籤「提示詞」改名「提示詞與正則」，加「🔣 正文正則」（`narrator/regex.ts`、`RegexPanel.vue`）：規則跟著提示詞組存（`PromptConfig.regex`），內建「刪掉思考區塊」；編譯一次快取、串流中節流只改顯示、收完整段套用一次並存下處理過的文字；`extractJson` 解析前先拿掉思考區塊。
- 匯入 SillyTavern 的 regex 腳本：轉成自己的格式（只收 AI 輸出、`{{match}}` → `$&`、`trimStrings` 變刪除規則），略過與拿掉的設定都列出來。
- R17 的其他項目（版本號、骰面判定、回合提示、設定匯出、規則說明）見下面同一天的紀錄；`roadmap/QOL_PLAN.md` 刪掉。規則寫在 [PROMPTS](../../PROMPTS.md) 6.1 節，測試在 `regex.spec.ts`。

### 2026-11-05 設定的匯出與匯入、遊戲內規則說明（R17 的 Q-6、Q-7）

- 設定的匯出與匯入（issue #62 第 2 條）：`stores/settingsFile.ts`、`SettingsFilePanel.vue`（設定頁的「存檔」改名「存檔與設定檔」）。原樣搬 `elondia.settings`、`elondia.image`、`elondia.promptSets`、`elondia.characters`；`apiKey` 預設清空，匯入時空的金鑰沿用原本的；匯入後重新整理頁面。規則寫在 [SAVES](../../SAVES.md) 第 8 節，測試在 `settingsFile.spec.ts`。
- 遊戲內規則說明（issue #62 第 19、21 條）：酒館「招募冒險者」的說明寫出雇用一次付清、沒有期限與週薪、戰利品不分、親密度太低會離隊；`GuardStatus.vue` 在聲望旁加「犯法的後果」（數字照 `security.json`）。只寫現有的規則，沒有新增規則。寫在 [COMPANIONS](../../COMPANIONS.md) 2.1 節、[NPC_SYSTEM](../../NPC_SYSTEM.md) 第 9 節，測試在 `ruleHints.spec.ts`。

### 2026-11-05 小改進：版本號、骰面判定、戰鬥的回合提示（R17 的 Q-1～Q-3）

- 版本號：`vite.config.ts` 用 `define` 把 `package.json` 的版本帶進程式（`__APP_VERSION__`，型別在 `env.d.ts`），首頁下方與設定的「存檔」頁顯示。
- 存檔規則「大成功、大失敗只看骰面」（`options.naturalCrit`）：`checks.ts` 的 `computeDegree` 多一個參數、`clampDegree` 收斂 AI 給的程度；主動行動、AI 入隊、談判、撤出地下城、打聽消息、提議夥伴去娼館都照這條；判定提示詞寫明規則。規則寫在 [ACTIONS](../../ACTIONS.md) 第 3 節、[SAVES](../../SAVES.md) 第 7 節，測試在 `naturalCrit.spec.ts`。
- 戰鬥的回合提示：`CombatView.vue` 播時間軸時排隊出「第 N 回合」「敵方行動」「輪到你了／輪到某某」（`fx.ts` 的 `banner` 多了 `turn`、`foe`、`ally` 三種小橫幅），設定「戰鬥的回合提示」（`settings.turnBanner`）可以關。寫在 [COMBAT_SYSTEM](../../COMBAT_SYSTEM.md) 8.3 節之後，測試在 `turnBanner.spec.ts`。
- 同一天：交涉的成交價不是喊價（B21）併進 R19 的購物車一起做（R19 的計畫，做完後刪掉）。

### 2026-11-05 對方主動邀請時不再要過邀請的檢定（L10，原 B22）

- 起因：玩家回報（[issue #62](https://github.com/yellow630914/ElondiaRPG/issues/62) 第 20 條）對方邀請、自己答應，卻因魅力檢定失敗入不了隊。白箱重現：AI 判定成功並給了入隊，`actions.ts` 的 `judgeJoin` 另外要求檢定總值達到邀請的 DC（重現時 18），沒達到就不入隊還加冷卻。酒館的「等待組隊」沒有這個問題（接受邀請不擲骰）。
- 擁有者決定：AI 判定的 `join` 效果可以帶 `offered`（對方先開口），親密度至少 30（`companions.json` 的 `invite.offered_min_affinity`）時不比邀請的 DC；人在身邊、冷卻、空位、小隊找隊長照舊；沒成時不加冷卻。親密度不夠時照一般邀請，結果寫明原因。判定的提示詞寫出現在的親密度算不算數。
- 規則寫在 [COMPANIONS](../../COMPANIONS.md) 2.5 節，測試在 `aiJoin.spec.ts`。

### 2026-11-05 寶箱的打造材料不再只給最便宜的（L11，原 B19）

- 起因：寶箱的打造材料一律是那一級最便宜的一件，第 2～5 級有 15 種開不出來（精鋼錠、硬化獸皮、絲綢布匹、古樹心材、金錠……），而且和地下城所在的地區無關（第 2 級皮革一律是沙丘豺皮）。
- 改成從那一級的候選裡平均抽一種：沒有怪物會掉的通用材料，加上這座地下城（各層與層主）與所在地區野外的怪物會掉的；一種都對不上時用那一級的全部（`gear.ts` 的 `chestForgeCandidates`、`localLootItems`）。實際上第 1～5 級的打造材料幾乎都有怪物會掉，通用的只有銀錠、金錠，所以多半是「當地怪物會掉的」優先，其他地方（緋夢樂園底下、高等地下城、炎華之地）開那一級的全部。
- 第 6、7 級照舊依地點的材料系列挑。材料委託與裝備的收購上限仍用最便宜的那一件（`forgeItemFor`）。
- 規則寫在 [ITEMS](../../ITEMS.md) 4.4 節；攻略的來源（`sources.ts`）列出每一級全部的候選，怪物素材標「這種怪物出沒的地方」。測試在 `items.spec.ts`。

### 2026-11-05 Bug 整理：修好 B23、B14，B22、B19 改記到業務邏輯問題

- B23 開戰的橫幅在手機上斷成兩行：`position: fixed; left: 50%` 的元素只拿得到半個畫面寬，左右內距又各 64px，連兩個字都放不下。`.fx-banner` 改成照內容的寬度（最多畫面寬減 16px），760px 以下縮小內距與字（`src/style.css`）；Chromium 量過 320～1280 寬都是一行。
- B14 形象圖同一毫秒的兩版互相蓋掉：各版用毫秒時間當 key，也用時間認出目前的那版；新增一版時同一毫秒已經有一版就往後挪 1 毫秒（`stores/portraits.ts` 的 `addVersion`），回歸測試在 `imageStudio.spec.ts`。
- B22（對方邀請仍要過邀請檢定）、B19（寶箱開不出大部分打造材料）白箱重現後確認是照設計運作，改記到 [LOGIC_ISSUES](../LOGIC_ISSUES.md) L10、L11。

### 2026-11-05 手機版畫面的實機測試（R10 結案）

- M1～M4 在 2026-10-30 完成並合併（規則見 [MOBILE_UI](../../MOBILE_UI.md)）；擁有者 2026-11-05 實機測試完，R10 結案。
- 剩下的已知小問題「開戰的地名橫幅在手機上斷成兩行」移到 [BUGS](../BUGS.md) B23（同一天修好，見上面）。
- 擁有者 2026-10-30 決定先不做的：手機橫拿；iPhone SE 直拿時主動行動列被地圖擠掉、打完的遭遇格還有「查看遭遇」、旅途最後一天的按鈕字、`viewport-fit=cover`；行囊升格成底部分頁列的獨立按鈕。

### 2026-11-05 慾望戰鬥的收尾移回點子庫（R8 → I24）

- S0～S10 都已完成（見下面 2026-11-02 與更早的紀錄）；剩下的神殿的淨化、園區規則的編輯器、新園區、防具的淫器合煉還沒決定要不要做，連同原則、要實際遊玩後再調的數值、決定不做的清單移到點子庫 [I24](../ideas/dev-discussion.md#i24)，刪掉 `roadmap/LUST_COMBAT_PLAN.md`。

### 2026-11-04～05 炎華之地：東大陸的南域與北原（R15）

- 範圍：東海之外的新大陸「炎華之地」，南域大燁（宋朝風格，等級從 Lv.1 開始）與北原媞丹（蒙古、金、遼風格）；新種族化龍族、靈狐族、人馬族。
- P1～P3（南域的骨架、地下城、人與地點）：四座聚落與航線、永昭陵／千窯谷／火藥坊遺址與 44 種怪物、36 位固定 NPC、19 個地標、5 張特殊地圖、新手委託、背景圖與世界總覽圖。
- P4～P5（南域的劇情與收尾）：種族線、各地故事線、地下城線、政治線上半、角色線、成人向角色與多人任務；任務戰鬥的勝率照西大陸調過；共和制之後皇城開放；世界書條目的「劇情變體」（政體段落依結局換掉）。
- P6～P8（北原）：人馬族與裝備欄的種族規則、金帳王庭與鷹河榷場、鳴鏑古戰場與白狼雪窟、18 位固定 NPC、北原的前期政治線與政治線下半「南北交會」、角色線與成人向、劇情條件「主角的種族」。
- 規則與資料寫在 [WORLD](../../WORLD.md)、[MONSTERS](../../MONSTERS.md)、[STORY_QUESTS](../../STORY_QUESTS.md)、[BACKGROUNDS](../../BACKGROUNDS.md)、[PROMPTS](../../PROMPTS.md) 第 5 節；設計與決定的紀錄留在 [EAST_CONTINENT_PLAN](EAST_CONTINENT_PLAN.md)、[EAST_CONTENT_PLAN](EAST_CONTENT_PLAN.md)（程式與產生腳本的註解有引用）。新 NPC 的立繪之後再補。

### 2026-11-03 自建地下城（R16 的 D1～D3）

- 起因：想先把「地點編輯器」做出來（東大陸之類的新區域的前一步）。盤點世界內容的依賴關係之後，決定先只做**地下城**：聚落牽涉區塊、設施、居民、勢力、房子，自建地區牽涉更多（盤點移到點子庫 [I23](../ideas/dev-discussion.md#i23)：玩家決定先不做，不確定性太大）。
- 和玩家一起定的：地下城經由旅途到達、路線**只能接聚落**；各層的遭遇記在**地下城上**，怪物編輯器改的是同一份；有自建地下城用到的自建怪物不能刪（附「從所有自建地下城拿掉」）；其他存檔人在被刪掉的地下城裡時送回聚落。
- D1 骨架：`engine/dungeonMods.ts`（格式、整理、套用與還原、`dungeonUsage`）、`engine/pruneLocations.ts`（讀檔與改內容後清掉指到不存在的地下城的資料）、`data.ts` 的 `reindexLocations`／`findLocation`／`locationName`、`world.ts` 的 `rebuildRoutes`；局部匯入匯出。
- D2 編輯器：`content/DungeonEditor.vue`、`engine/dungeonPreview.ts`（各層的等級、建議階級、寶箱等級與提醒，7 天內的公會，照內建地下城複製、依等級自動填）、怪物編輯器的「自建地下城」一段；旅行不會穿過地下城（不會變成捷徑）；日誌的場景帶上給 AI 的描述。
- D3 連動與收尾：特殊任務、地下城事件、特殊地圖、情報物品引用自建地下城的測試；世界檢查（`__tests__/worldCheck.ts`）認得地下城並跑自建地下城的層主戰；AI 編排特殊任務的地點清單附上描述；`worldgen/guides/dungeons.md`。
- 收尾：地下城可以上傳一張圖，在裡面當整頁背景（縮到 1280 以內的 WebP，存在世界裡）；匯入「取代全部內容」先還原成原版再整理新內容，拿掉的自建地下城與改了所屬地點的特殊地圖列在頁面上方，匯入按鈕旁有 ⚠ 說明（存檔照 `pruneLocations` 清理，不會壞）。
- 規則寫在 [CONTENT_EDITOR](../../CONTENT_EDITOR.md) 3.96 節、[CONTENT_DEPENDENCIES](../../CONTENT_DEPENDENCIES.md) 第 1、2 節、[WORLD](../../WORLD.md) 第 1 節、[DUNGEON_DESIGN](../../DUNGEON_DESIGN.md) 第 2 節、[MONSTERS](../../MONSTERS.md)、[worldgen/guides/dungeons](../../../worldgen/guides/dungeons.md)。測試：`dungeonMods.spec.ts`、`dungeonEditor.spec.ts`、`worldCheckTool.spec.ts`。

### 2026-11-02 慾望戰鬥 S10：流派的老師與秘法書、寄生類的雙面效應、稱號（R8）

- 擁有者的決定：補一定數量的流派老師與秘法書；補寄生類的雙面效應；聲望交叉與身分標籤不只看曝露名聲，也看其他慾望指標，**目前只給稱號、沒有效果**；奧托三世（LOGIC_ISSUES L5）、哥布林左耳（L4）先不動。
- 老師：固定 NPC 的 `mentor`（`perks.json` 的 `mentor` 預設），在身邊時受訓面板多出他教的特質；8 位流派老師。秘法書 8 本，所有特質書只給現在學得了的特質。寄生類的雙面效應（`lewd.json` 的 `parasite_two_face`）。稱號 15 個（`lewd.json` 的 `titles`）。資料由 `worldgen/scripts/elondia/lust_s10.py` 產生；規則在 [LEWD_STATS](../../LEWD_STATS.md) 第 6.1、14.1、28 節。

### 2026-11-01 魔物娘與擴大發情（R14）

- 目的：補足陽剛體型主角的成人內容。調查時發現兩個原因：會在戰敗後起意的怪物只有標了 `rut` 的 54 隻（48 隻是野獸），而且怪物的 `desc` 根本沒有送給 AI（只在圖鑑顯示，敘事只拿到名字）。
- 規則（和玩家一起定的）：近郊、旅途、地下城的人形、魔族、妖精、元素、構裝、植物、野獸、靈體普遍允許發情；排除不死、節肢（保留原本會發情的蠍、蟹、毒粉蛾、聖甲蟲女王，另外加上近郊與地下城的三種蜘蛛）；之後合進來的高等地下城照同一套規則，歷史裂縫、歷史迴廊有形體的 6 種改成野外發情，禁果庭園、歡愉秘宮算主題園區、群體、幼體與嬌小的、只有部位的、亡魂類、沒有形體的、映照你自己的，以及有名有姓的人物等 14 隻；主題園區（之後的禁果庭園、歡愉秘宮也是）與只在特殊任務登場的不動。新加的發情只在野外（`rut: "field"`），特殊任務的戰鬥任務點寫了 `rut` 才擲。會發情的都要有魔物娘形態（`girl`）。
- 結果：保留發情 37 隻、新增「野外」發情 114 隻、拿掉發情 8 隻；151 隻都寫了魔物娘（成年女性）。設定「魔物娘」、戰報的 `others[].monster` 與提示詞的 `<monsters>`（`narrator/monsters.ts`）、怪物編輯器的欄位與清單的篩選、插圖分鏡。測試：`monsterGirls.spec.ts`。規則寫在 [MONSTERS](../../MONSTERS.md)、[COMBAT_SYSTEM](../../COMBAT_SYSTEM.md) 8.2 節、[PROMPTS](../../PROMPTS.md)。

### 2026-10-31 打聽、傳聞與怪物圖鑑（Discord 回饋）

- 玩家回饋：打聽時 AI 編出不存在的地名、玩家核對地圖後仍然圓下去；「具體情況」「弱點」都只寫成空話。原因是判定看不到附近真的有什麼，正文的寫手又不能寫報告沒有的東西。
- 判定的 `findings`（寫進報告、日誌顯示「得知」、正文要說出來）、打聽時的 `<world_facts>`、驗證過的 `rumor` 效果（情報頁的傳聞，或地圖上的事件點）、怪物圖鑑（聽說、遭遇、擊敗）。規則見 [ACTIONS](../../ACTIONS.md) 第 7 節、[MONSTERS](../../MONSTERS.md) 的「怪物圖鑑」。

### 2026-10-30 特殊任務生成器（R11 的 E4）

- 世界編輯器特殊任務頁籤的「✨ AI 編排」（`content/QuestGenDialog.vue`、`stores/questGen.ts`）：描述 → 大綱（可以改）→ 完整內容 → 沙盒檢查（有錯誤時交回 AI 修，最多 2 次）→ 流程圖預覽 → 加入世界（走局部匯入的寫入）；草稿存在瀏覽器。
- 提示詞（`narrator/questGenSpec.ts`，列舉值由程式的常數產生）與目錄（`narrator/questCatalog.ts`）；新的 AI 功能「世界設計」（`designer`）。
- 整理（`engine/questGen.ts`）：代號換 id、旗標前綴、報酬與價格依等級、新怪物、技能、狀態的數值夾在內建的範圍、地標找格子、特殊地圖做成隨機地圖；不允許的種類拿掉並列出。
- 測試：`questGen.spec.ts`、`questGenSpec.spec.ts`、`questGenStore.spec.ts`（固定的 AI 回覆）。規則寫在 [STORY_QUESTS](../../STORY_QUESTS.md) 第 3 節、[PROMPTS](../../PROMPTS.md) 第 8 節；沒做的（怪物的模擬、大綱的圖……）留在 [WORLD_EDITOR_PLAN](WORLD_EDITOR_PLAN.md) 第 4 節。

### 2026-10-30 這裡的人在做什麼（點子 I21，Discord 回饋）

- 玩家回饋：希望看到附近的人在做什麼、比較有活人感，又不想每個人都花 token。照另一位玩家的建議用程式規則決定。
- 活動表 `data/rules/npc_activities.json`（格子、區域、身分、職業、性格、時段），固定亂數每兩小時換一件事；「這裡的人」名牌下面一行；報告附上身邊的人（`bystanders`）交給敘事。規則見 [NPC_SYSTEM](../../NPC_SYSTEM.md) 7.1 節。
- 還沒做：時段之間依活動走到下一格（出門、回家、上工），讓地圖上的人會動；判定請求不帶旁邊的人；活動表還不能在世界編輯器裡改。

### 2026-10-30 日誌插圖自動生成（點子 I22，Discord 回饋）

- 玩家回饋：手動配圖的按鈕在日誌最上面的「⋯」，圖卻在最下面，每次都要捲回去按。
- 設定加「自動生成」（關閉／只畫成人場景／每一則，預設關閉），正文第一次寫完時自動畫；沒有正文的日誌不畫。「寫出經過」「生成插圖」搬到日誌底下，只放圖示。規則見 [PORTRAITS](../../PORTRAITS.md) 第 7 節。

### 2026-10-30 文件整理（v0.4.0 之後）

- `docs/*` 的系統文件逐份對過程式與資料（36 份），改正數量、規則與漏寫的功能；途中找到的程式問題修掉四個：
  - B15：拿掉舊的 `travel()` 後，只寫「旅行途中的危險」（`travel`）的加減沒有作用（野外求生、怕水、懼高、紅溪蛇鱗）。旅途事件的檢定改成同時算 `road` 與 `travel`，一個條件兩個都寫只算一次（`perks.ts` 的 `CheckCtx.also`、`road.ts` 的 `roll`）。
  - B16：等待中的城鎮事件、旅途事件沒有擋住短休與旅店長休（`rest.ts` 的 `restEventBlock`）。
  - B17：刪自建技能時沒檢查固定 NPC 與主奴、娼館事件的 `teaches`（`mods.ts` 的 `abilityUsage`）。
  - B18：12 件第三級材料的淫服沒有「城市以上」（`lust_s9.py` 補上 `min_location`）。
- `docs/plan` 只留五份：BUGS、LOGIC_ISSUES、README、RETROSPECTIVE、ROADMAP；各項計畫的細節搬到 `roadmap/`，只留還沒做的部分；做完的部分收在這份。
- 點子庫：已經變成 ROADMAP 的刪掉（I13 淫氣世界世界書 → R8；I5 的前半 → R11），2026-10 盤點的點子（I8、I9、I12）與 UI v2 沒做的部分併進早期發想。
- 手機版的版面規則寫成系統文件 [MOBILE_UI](../../MOBILE_UI.md)。

### 2026-10-30 特殊任務的流程圖（R11 的 E3）

- 可達性（`src/engine/storyReach.ts`）：列舉「完成了哪些任務點＋任務自己的旗標」的每一種狀態，找出不會解鎖的任務點、走不到完成、選了會卡住的結果；加進「檢查任務鏈」的提醒，內建任務零筆。
- 流程圖（`storyGraph.ts`、`content/StoryGraph.vue`）：分層排版、結果的出口、旗標的線、任務外面的旗標、存檔進度；任務編輯器「📋 清單／🕸️ 流程圖」。
- 故事線總覽（`storylines.ts`、`content/StorylineOverview.vue`）：接取條件、開始特殊任務、不能有、呼應；特殊任務頁籤的「🗺️ 故事線總覽」。
- 測試：`storyReach.spec.ts`、`storyGraph.spec.ts`、`storylines.spec.ts`。規則寫在 [STORY_QUESTS](../../STORY_QUESTS.md) 第 3 節；沒做的（手機直排、flowdoc 改用同一份模型）留在 [WORLD_EDITOR_PLAN](WORLD_EDITOR_PLAN.md)。

### 2026-10-30 局部匯入與匯出（R11 的 E1、E2）

- 關聯（`src/engine/contentRefs.ts`）：寫了誰的 id 或名稱、物品 ← 掉落它的怪物、制式裝備 → 自建的底材與材料、旗標與計數器的讀 → 寫；選一項一定連同它用到的東西（閉包），反方向只列出來。
- 局部匯入（`contentImport.ts`、`content/ImportPickerDialog.vue`）：來源是檔案或另一個世界；一樣的沿用，不同的選取代、保留或另存一份（id 加 8 碼指紋、物品名稱加「（2）」、另存的任務自己的旗標加後綴）；沙盒預檢查；世界記下匯入時的指紋，看得出新版本。
- 局部匯出：清單「☑ 選取匯出」，連同用到的東西，`meta` 記勾了哪幾項與指紋。
- 自建項目的 id 亂數加長到 8 碼；修好世界綁定的提示詞組重新整理後會不見。
- 測試：`contentRefs.spec.ts`、`partialImport.spec.ts`。規則寫在 [CONTENT_EDITOR](../../CONTENT_EDITOR.md) 第 0 節、[CONTENT_DEPENDENCIES](../../CONTENT_DEPENDENCIES.md) 第 1.1 節；沒做的留在 [WORLD_EDITOR_PLAN](WORLD_EDITOR_PLAN.md)。

### 2026-10-30 世界編輯器的介面整理（R11 的 E5）

- 頁籤分成五組（戰鬥、角色、物品、地點、劇情）、篩選列由設定產生、原版世界只能瀏覽（修改時自動建立「我的世界」並切換過去）、頁尾收成選單。
- 共用元件：`EditorHeader`、`RequiresEditor`、`CheckList`、`CellGrid`、`MonsterPick`、`CheckRow`、`FoldSet`（每個區塊都能收起並記住）、`HelpText`；結果的一行摘要（`OutcomeEditor`）。
- 未儲存保護（`unsaved.ts`）：換項目、頁籤、世界、離開世界頁或關掉網頁前先確認。
- 來回測試（`editorRoundTrip*.spec.ts`）：每種編輯器打開內建項目、不改就存，內容要和原本一樣。
- 規則寫在 [CONTENT_EDITOR](../../CONTENT_EDITOR.md)；沒做的（「新增先不存」、E1～E4）留在 [WORLD_EDITOR_PLAN](WORLD_EDITOR_PLAN.md)。

### 2026-10-30 手機版 UI（R10 的 M1～M4）

- M1 骨架：720px 以下換成手機版面（`src/components/mobile/`）：狀態列、地圖與日誌的探索／閱讀兩種狀態、情境按鈕、底部分頁列、半屏面板、全螢幕頁面、返回鍵的層級堆疊。
- M2 分頁滑動（`SwipeTabs`）：隊伍、角色詳情、交易可以左右滑換分頁。
- M3 細修：逐頁檢查排版；M4 戰鬥畫面：我方在上、敵人在下、兩行紀錄、依類型分頁的技能、長按看說明。
- 模擬手機實測後的修正：窄螢幕的行囊與交易、設定表格、選目標、名字捲動、打字時藏起分頁列、返回鍵「再按一次離開」。
- 規則寫在 [MOBILE_UI](../../MOBILE_UI.md)；沒做的（實機測試、橫拿）當時留在 MOBILE_UI_PLAN（2026-11-05 R10 結案時刪掉，見上面的紀錄）。

### 2026-10 UI 改版（v2，原 R2）

視覺方向：HD-2D 風，深色皮革底、金色雕花框、羊皮紙對話框、像素圖示與地圖格（樣稿 `docs/mockups/ui-v2.html`）。

- P0 設計系統：顏色與字級 token（`src/style.css`）、內建字型（Noto Serif TC、霞鶩文楷 TC，`@fontsource`，不連外部）、「?」說明（`ui/Hint.vue`）、介面圖示（Pixelarticons，`ui/GameIcon.vue`）、羊皮紙對話框（`AppDialog.vue`）、素材授權（`data/credits.json`）。
- P1 版面：頂部 HUD、日誌上方的工具列、迷你隊伍卡、日誌依類型的色條與圖示、「這裡的人」的頭像與常用互動、程式生成的像素地圖格。
- P2 隊伍：角色卡、角色詳情的分頁、紙娃娃、刺青部位圖。
- P3 物品圖示：自己畫的類別與底材像素圖，玩家可以上傳覆蓋（[ITEMS](../../ITEMS.md) 第 8 節）。
- P4 店名與描述：依地區的字庫生成，手寫覆寫，AI 潤飾（`shopNames.ts`，[TRADE](../../TRADE.md)）。
- P5 建築選單：場景橫幅、店名、老闆招呼語與功能選單；酒館拆成用餐、招募、組隊、邀請熟人、黑市。
- P7 全介面套用設計系統。合併時兩輪 code review 修掉的問題（對話框裡的說明、談判開始時關對話框、開著對話框時地圖不吃按鍵……）。
- 沒做的 P6 模組化像素立繪、地圖格的 tileset 改放點子庫（[early-design](../ideas/early-design.md) I19、I20）。

### 2026-10-30 v0.4.0：慾望戰鬥（R8 的 S0～S9）

- 慾望戰鬥的九個階段全部完成並發布：技能攜帶上限、戰鬥核心、長期指標與服裝、流派與雙面效應、事件編輯器、奴隸與娼館、打工線技能、緋夢樂園、S8 的連動、S9 的拘束具與事件。規則在 [COMBAT_SYSTEM](../../COMBAT_SYSTEM.md) 第 8.5 節、[LEWD_STATS](../../LEWD_STATS.md)、[LUST_PARK](../../LUST_PARK.md)；沒做的部分當時留在 LUST_COMBAT_PLAN，R8 改成收尾（2026-11-05 移到點子庫 [I24](../ideas/dev-discussion.md#i24)）。
- 固定 NPC 的內建形象圖（54 位，`src/assets/portraits/`，[PORTRAITS](../../PORTRAITS.md)）；轉檔腳本 `tools/portraits/finalize.py`。
- 存檔格式升到 11（「魅魔女王」改名「緋夢夫人」的物品名稱遷移）。

### 2026-10-28～29 v0.3.6、v0.3.7

- 城鎮移動的效能：任務用到的地標、小隊表、城鎮的基底地圖依內容版本（`contentRevision`）算一次就記住，畫面共用所在地點；王都每步的腳本時間約 45 ms → 9 ms（[CONTENT_DEPENDENCIES](../../CONTENT_DEPENDENCIES.md) 的快取一節）。
- 主動行動可以選最多 3 個對象（[ACTIONS](../../ACTIONS.md)）；主動行動移到冒險日誌底部、等待判定的行動顯示在日誌裡。
- 玩家回饋：特質【星夜露宿】，可以在野外紮營長休（[PERKS](../../PERKS.md)）。盤點特質取得方式時發現的缺口記成 [LOGIC_ISSUES](../LOGIC_ISSUES.md) L5。
- 拿掉「成人向」開關，AI 改成依日誌分流成人場景（[PROMPTS](../../PROMPTS.md)）。

### 2026-10-29 正文的銜接、篇幅與判定（I15～I18，玩家心得）

- I15 前後銜接：敘事與判定帶上一段正文的結尾與幕間（沒有寫成正文的日誌、走過的地方），提示詞設定可以關閉（[PROMPTS](../../PROMPTS.md) 3.1 節）。
- I16 篇幅：自由行動改成中篇；提示詞設定加「正文篇幅」（偏短、標準、偏長）；敘事規則的段落規則統一（[PROMPTS](../../PROMPTS.md) 第 3 節）。
- I17 依難易度判定：AI 判為日常小事時至少成功、判定規則要求一輪做到有結果、自由行動的時間由 AI 估計（[ACTIONS](../../ACTIONS.md) 第 1 節）。「日常小事不擲骰」的按鈕還沒做，留在點子庫 I17。
- I18 正文的寫法：本次要求輪替開場與收尾，可以關閉；negative 列出要少用的套話（[PROMPTS](../../PROMPTS.md) 3.2 節）。
### 2026-10-29 主角身分標籤的效果（點子 I10）

- 9 個主角可選的標籤都有了效果（檢定的加減、商店與神殿的價格、曝露名聲的累積、被賣時的身價、戰鬥中的慾望抗性），寫在 `npc_tags.json` 的 `pc_effects`，規則見 [NPC_SYSTEM](../../NPC_SYSTEM.md) 4.1 節；AI 的主角資料寫出身分。

### 2026-10-28 程式整理（R3～R7）

- R3：拿掉舊的 `travel()` 與它的 `EVENT_CHANCE`、`resolveEvent`，測試改用 `src/__tests__/helpers/travel.ts`（`arriveAt` 直接抵達、`walkTo` 一路走完旅途）。旅途事件的機率只看 `travel_events.json` 的 `chance`。
- R4：拿掉沒有被讀取的 `economy.json` 的 `price_variance`（整組都沒有程式讀）與 `npc_population.json` 的 `known_weight`。
- R5：更新 `road.ts`、`travel.ts`、`crafting.ts` 開頭的過時註解。
- R6：世界編輯器的「🖼️ 類別圖示」改成獨立分頁，物品列表不再有假的一列。
- R7：`npm run docs:gen` 依資料檔重新產生 COMBAT_SYSTEM 第 9 節的能力表、MONSTERS 的怪物表、ITEMS 的制式裝備與消耗品、卷軸、書籍表（`src/__tests__/docTables.ts`）；`docTables.spec.ts` 檢查文件和資料檔一致，改了資料忘記重跑會失敗。ITEMS 其他的表（獨特物品、材料、底材……）照舊手寫。

### 2026-10 文件整理

- 原本的 `KNOWN_ISSUES.md`（程式中發現的問題）與 `OPEN_QUESTIONS.md`（待決定事項）拆成 BUGS、LOGIC_ISSUES、ROADMAP、點子庫四份（點子庫之後再依來源拆成 `ideas/` 目錄），`UI_V2_PLAN.md` 一起搬進這個資料夾。重複的項目合併（例如 D4 與 I5 都是地下城探索彙整報告，現在是點子庫的 I7）。
- B1「地標場景的插圖只畫主角」已修好：在場的人記進報告的 `others`。
- B1（原 Q2）世界書「价格参考-货币体系」永遠不會注入：刪掉這條。它寫的是銅銀金白金四種貨幣，和只有白鸛幣衝突；換算本來就在 `{{currency}}`，原本各幣種的用途改成一句大約的物價加進 `{{currency}}`。

### 2026-10 整理時刪掉的項目（原本的待決定事項）

- I1 特殊任務與固定 NPC 的內容量（v0.3.0：400 多個特殊任務、112 位固定 NPC 與 30 位成人向角色）、I2 更多特殊地圖（v0.3.0：18 張，含六個特殊區域的內部與史詩的大場面地圖）。

依程式判定已經解決或不再適用，從各文件刪除：

- GAME_DESIGN：地下城分層探索、旅途遭遇戰、戰鬥中使用道具／換裝／裝備商店、其他區域的遭遇表（`enemies.json` 已涵蓋 7 個地區、16 座地下城）、「NPC 只有 6 位」。
- DUNGEON_DESIGN 第 9 節：路線分岔（改成格子地圖）、光源（已做）、安全房每間一次（已做；存檔不分地點）、戰敗懲罰（存檔規則：保留／一半／全部）、周邊的資源壓力（有遭遇、陷阱、晚上要光源）、重複探索（每次進入重新生成）。
- QUEST_EVENT_DESIGN 第 8 節：任務生成時機與歸屬（任務改成人工編寫，放在「世界」裡匯出匯入）、主動行動的成本（每種有 `hours`，擲骰存檔不能重擲，戰鬥中不能做）、NPC 的持久化（會登錄）。整份文件是早期提案，已刪除；還沒做的構想收在[點子庫](../ideas/README.md) I5。
- WORLD_NOTES：玩家名寫死「沈頤」（注入時換成主角名）、「境界數值」的定義（用生命層級差）、簡繁比對（opencc）、公會升級需求與等級區間不同（改成功績加考核制）。其餘條目移到 [LOGIC_ISSUES](../LOGIC_ISSUES.md)，文件已刪除。
- NPC_SYSTEM：「已確認的決定」5 項都已實作；一般人生活費定為每天 15 白鸛。
- 特質 P5：苔語村、珊瑚灣鎮、靜潮綠洲、滄月闕沒有空地；索里耶爾、晨光城的貴族區沒有空地。前四座的地圖把幾格水道改成建築格，建築格不夠時改用街屋補（見 HOMES 第 1 節）。
- 2026-10 實作：D6 委託期限（一般委託依地點、特殊任務的 `time_limit`，見 GUILD 第 0 節、STORY_QUESTS）；C3 動作中途出錯時還原成動作之前的狀態（`game.ts` 的 `run()`）；D7 的「事件導演」做成城鎮事件。
- 2026-10 決定並實作（結論寫進 WORLD、GUILD、DUNGEON_DESIGN、STORY_QUESTS、CONTENT_DEPENDENCIES）：W1～W3 補上西部荒野、滄月闕、灰港鎮↔珊瑚灣的路線（天數為推估，標 `estimated`；潮汐港↔滄月闕收船資）；W4 地下城不再有整座的階級，改看每一層的怪物；W5 S 級涵蓋 13～20 級；W6 南境主城採血羽城堡，並收錄腐沼村；W7 收錄風錘村；W9 獸骨荒丘在南境北部；W10 沿海渡口寫進世界書；W11、W12 接受現有天數；C1 改動會弄壞目前存檔的任務進度時擋儲存；C2 檢查任務鏈分成錯誤（擋儲存與匯入）與提醒。
- W8：「雪嵴」「雪脊」統一為「雪嵴」（世界書的 4 處一起改，關鍵字也能對上遊戲裡的「雪嵴哨站」）。
- W13～W15：世界書概述條目的中央平原補上索里耶爾、阿爾貝納（與聖環教廷、奧德聯邦）；熔火堡壘的特色建築改成自己的（千爐工坊、熔魂井、機偶校場），不再和血羽城堡重複；雪嵴哨站補寫特徵、社會風貌、政治角色與特色建築（長明烽火）。世界觀資料的待確認事項已全部處理完。
- 特質 P1、P2、P4（2026-10 實作）：陷阱、開鎖、撤退、偷偷離隊的檢定加上熟練加值（戰敗事件的「敵人起意」刻意不加）；種族天賦改成 `perks.json` 的種族特質（依種族計算、不能選或失去，數值不變）；內容頁籤新增「🌟 特質」，物品編輯器可以設定書籍教哪些特質。結論寫進 DUNGEON_DESIGN、COMPANIONS、ITEMS、COMBAT_SYSTEM、PERKS、CONTENT_EDITOR、CONTENT_DEPENDENCIES。
