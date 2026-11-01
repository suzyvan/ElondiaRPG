# 已完成

> 上層：[計畫與追蹤](../README.md)。做完的計畫在這裡記一段：做了什麼、規則寫在哪份系統文件。細節以系統文件為準，這裡只是索引。新的紀錄加在最上面。

### 2026-11-01 魔物娘與擴大發情（R14）

- 目的：補足陽剛體型主角的成人內容。調查時發現兩個原因：會在戰敗後起意的怪物只有標了 `rut` 的 54 隻（48 隻是野獸），而且怪物的 `desc` 根本沒有送給 AI（只在圖鑑顯示，敘事只拿到名字）。
- 規則（和玩家一起定的）：近郊、旅途、地下城的人形、魔族、妖精、元素、構裝、植物、野獸、靈體普遍允許發情；排除不死、節肢（保留原本會發情的蠍、蟹、毒粉蛾、聖甲蟲女王，另外加上近郊與地下城的三種蜘蛛）、群體、幼體與嬌小的、只有部位的、亡魂類、沒有形體的、映照你自己的，以及有名有姓的人物等 14 隻；主題園區（之後的禁果庭園、歡愉秘宮也是）與只在特殊任務登場的不動。新加的發情只在野外（`rut: "field"`），特殊任務的戰鬥任務點寫了 `rut` 才擲。會發情的都要有魔物娘形態（`girl`）。
- 結果：保留發情 37 隻、新增「野外」發情 108 隻、拿掉發情 8 隻；145 隻都寫了魔物娘（成年女性）。設定「魔物娘」、戰報的 `others[].monster` 與提示詞的 `<monsters>`（`narrator/monsters.ts`）、怪物編輯器的欄位與清單的篩選、插圖分鏡。測試：`monsterGirls.spec.ts`。規則寫在 [MONSTERS](../../MONSTERS.md)、[COMBAT_SYSTEM](../../COMBAT_SYSTEM.md) 8.2 節、[PROMPTS](../../PROMPTS.md)。

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
- 規則寫在 [MOBILE_UI](../../MOBILE_UI.md)；沒做的（實機測試、橫拿）留在 [MOBILE_UI_PLAN](MOBILE_UI_PLAN.md)。

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

- 慾望戰鬥的九個階段全部完成並發布：技能攜帶上限、戰鬥核心、長期指標與服裝、流派與雙面效應、事件編輯器、奴隸與娼館、打工線技能、緋夢樂園、S8 的連動、S9 的拘束具與事件。規則在 [COMBAT_SYSTEM](../../COMBAT_SYSTEM.md) 第 8.5 節、[LEWD_STATS](../../LEWD_STATS.md)、[LUST_PARK](../../LUST_PARK.md)；沒做的部分留在 [LUST_COMBAT_PLAN](LUST_COMBAT_PLAN.md)，R8 改成收尾。
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
