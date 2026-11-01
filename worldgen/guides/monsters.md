# 怪物（`enemies`）

> 新增或修改怪物：欄位、範圍、出現地點、掉落、技能，以及數值怎麼挑。檔案的外層與 id 規則見 [content-file](content-file.md)。
> 系統文件：[MONSTERS](../../docs/MONSTERS.md)（內建怪物、耐打度與輸出的目標）、[COMBAT_SYSTEM](../../docs/COMBAT_SYSTEM.md)（命中、傷害倍率、特徵、敵人 AI、層主規則）、[CONTENT_EDITOR](../../docs/CONTENT_EDITOR.md) 第 1 節（編輯畫面）。程式：`src/engine/mods.ts` 的 `sanitizeEnemy`（整理）與 `applyPlacements`（出現地點）、`src/engine/data.ts` 的 `EnemyDef`。

## 1. 用途與放在哪裡

- 區塊：`content.enemies`，key 是怪物的 id。
- **新的怪物**：id 用 `mod_enemy_<英文小寫>`（例：`mod_enemy_ash_wyrm`），加 `"custom": true`。
- **修改內建的怪物**：用原本的 id（查 `data/rules/enemies.json`），不加 `custom`，寫整份修改後的資料。`offense` 每個 key 最多 7（內建的層主也在這個範圍內），原樣抄過來不會被改。
- 項目裡可以不寫 `id`；寫的話要和 key 一樣。
- 新怪物一定要放進遭遇表（`spawns`）或被特殊任務用到，不然遊戲裡遇不到（世界檢查會提醒）。

## 2. 欄位一覽

沒有寫的欄位用預設值，不會被當成錯誤；**寫了但不合規則的值會被默默改掉**（第 6 節）。

| 欄位 | 型別 | 範圍 | 說明 |
|---|---|---|---|
| `name` | 字串 | 最多 20 字 | 顯示的名字。不要和內建或別的怪物同名。空白時變成「未命名的怪物」 |
| `level` | 整數 | 1～30（預設 1） | 等級。決定熟練加值、技能的 `scale`、掉裝備的機率；平衡模擬用同等級的隊伍。玩家最高 20 級，內建最高 13 |
| `kind` | 字串 | `beast` 野獸、`humanoid` 人形、`undead` 不死、`spirit` 靈體、`construct` 構裝、`plant` 植物、`demon` 魔族、`elemental` 元素、`fey` 妖精 | 種類（篩選與給 AI 的描寫）。其他值整個拿掉 |
| `attrs` | 物件 | 每項整數 1～30（預設 10） | `str` 力量、`dex` 靈巧、`int` 智力、`fai` 信仰、`cha` 魅力。影響命中、迴避（靈巧）、豁免、技能 DC 與傷害的調整值，見 COMBAT_SYSTEM 第 1、3、5 節 |
| `hp` | 整數 | 1～9999（預設 10） | 最大生命。依耐打度挑（2.1 節） |
| `ap` | 整數 | 1～12（預設 3） | 行動點上限，開戰時全滿。怪物每回合固定回復 2 點（不隨等級增加），武器攻擊花 2 點，所以 `ap` 越高越能一回合連出好幾招 |
| `weapon` | 物件 | 見下 | 普通攻擊。沒寫時是 `1d6` 斬擊、力量 |
| `weapon.dice` | 字串 | `XdY` 或 `XdY+Z`：X 1～20、Y 2～100、Z 0～99 | 攻擊骰。**不能寫減號、不能省略 X**（`1d6-1`、`d8` 都會變成 `1d6`） |
| `weapon.type` | 字串 | 13 種傷害屬性的 id（預設 `slashing`） | `bludgeoning` 鈍擊、`piercing` 穿刺、`slashing` 斬擊、`fire` 火焰、`cold` 寒冰、`lightning` 閃電、`thunder` 雷鳴、`acid` 酸蝕、`poison` 毒素、`radiant` 神聖、`necrotic` 暗影、`force` 奧術、`psychic` 心靈。物理三種才吃防具減傷 |
| `weapon.attr` | 字串 | `str`、`dex`、`int`、`fai`、`cha`（預設 `str`） | 命中與傷害加的屬性 |
| `evade` | 整數 | -10～20（預設 0） | 迴避修正（像防具的迴避） |
| `dr` | 整數 | 0～30（預設 0） | 減傷，只擋物理傷害（COMBAT_SYSTEM 第 6 節） |
| `resist` | 物件 | key：13 種屬性、`physical`、`elemental`、`divine`、`arcane`、`all`；值 -1～2，取到小數 2 位 | 受傷倍率的加減：-1 免疫、-0.5 減半、+0.5 弱點。同一次傷害的屬性、群組、`all` 會疊加。值是 0 的拿掉 |
| `offense` | 物件 | 每個 key -1～**7**（`resist` 仍是 -1～2） | 攻擊加成：傷害 ×(1 + 加總)。小怪上限 ×5（`all` 4）、層主上限 ×8（`all` 7），見 [MONSTERS](../../docs/MONSTERS.md)。套在普通攻擊與所有技能上 |
| `abilities` | 字串陣列 | 存在的能力 id，不能是法術 | 會用的技能與戲法（內建、同一個檔案自建的都可以；職業技能也行）。怪物沒有法術環，`type: spell` 的會被拿掉。重複的合併 |
| `ability_hp_below` | 物件 | key：`abilities` 裡的 id；值整數 1～99 | 生命 ≤ 這個百分比才能用（層主的低血大招）。不在 `abilities` 裡的 key 拿掉 |
| `xp` | 整數 | 0～99999（預設 25） | 打倒時的經驗（特徵另有倍率） |
| `money_cc` | `[最少, 最多]` | 各 0～1000000 | 打倒時給的錢（白鸛）。要剛好兩個數；兩個都是 0 時拿掉；順序會排成小、大 |
| `loot` | 陣列 | 每項 `{ item, chance, qty }` | 掉落物，見 2.3 節 |
| `armed` | `true` | 只能寫 `true` | 持有裝備：打倒時有機會掉一件依等級生成的裝備（12% + 每級 2%，最多 35%）。給人形怪物用 |
| `rut` | `true` | 只能寫 `true` | 開戰時可能擲到「發情」特徵（COMBAT_SYSTEM 8.2 節；成人向的戰敗事件會用到） |
| `traits` | 字串陣列 | `monster_traits.json` 的特徵 id | 一定帶著的特徵，見 2.4 節 |
| `desc` | 字串 | 最多 200 字 | 給 AI 的一句描述（外觀、習性） |
| `habitats` | 字串陣列 | 不檢查 | 內建資料標的棲地（地區 id），遊戲沒有用到。可以不寫 |
| `spawns` | 陣列 | 每項 `{ table, count, weight }`（層主可以再寫 `guards`） | 加進哪些遭遇表，見 2.2 節 |
| `exclude` | 字串陣列 | 遭遇表的 key | 從**內建**遭遇表拿掉這隻怪物（只對修改內建怪物有意義），見 2.2 節 |
| `custom` | `true` | | 新的怪物要寫 |

布林欄位（`armed`、`rut`）只寫 `true`；不需要就不要寫，寫 `false` 會被當成改動列在報告裡。

### 2.1 怎麼挑數值

目標都在 [MONSTERS](../../docs/MONSTERS.md) 開頭的說明，世界檢查用同樣的模擬量：

- **耐打度**（調 `hp`）：和怪物同等級的 4 人隊伍打牠，**小怪要挨 3～5 下、層主要撐 4～5.5 回合**。模擬時拿掉弱點與特徵（`traits` 的巨大 ×1.5 不算），保留抗性與 `dr`。
- **小怪的輸出**（調 `offense`）：兩隻一組打同等級的隊伍，每場掉的生命依怪物出現的**最淺**區域：城郊 25～35%（1 人隊伍）、地下城周邊 20～30%（2 人）、淺層 15～20%（3 人）、只在中層以下 10～15%（4 人），勝率 85% 以上。
- **層主的輸出**（調 `offense`，不夠再加 `ap`）：4 人隊伍打層主那一場，勝率目標淺層 80%、中層 75%、深層 70%、底層 65%（±10%）。層主戰會擲特徵，`traits` 的效果算在裡面。
- **等級**跟著位置走（MONSTERS 開頭）：城郊 1 級起；地下城周邊 1、淺層 2、中層 4、深層 6 級起，層主 3、5、7 級起；底層小怪 11～12、層主 13。地區加成：中央平原 +0，古樹森林、東海群島、西部荒野 +1，北境群山 +2，南境枯萎荒原 +3。

起點可以參考內建怪物的中位數（`data/rules/enemies.json`），再照模擬調整：

| 等級 | 小怪 `hp` | 小怪 `xp` | 層主 `hp` | 層主 `xp` | `ap` |
|---|---|---|---|---|---|
| 1～2 | 14～16 | 25～70 | — | — | 3～4 |
| 3～4 | 22～25 | 130～200 | 220～240 | 210～320 | 小怪 4、層主 5 |
| 5～6 | 28～30 | 280～365 | 320～345 | 445～590 | 小怪 5、層主 6 |
| 7～9 | 38～45 | 465～675 | 400～510 | 740～1080 | 小怪 5、層主 6 |
| 11～13 | 50～60 | 900～1020 | 約 900 | 約 1850 | 小怪 6、層主 7 |

調整的方法：

1. 先寫好等級、屬性、武器、技能、抗性；小怪先不寫 `offense`（寫 0 會被拿掉並列在報告裡），層主先寫 `{ "all": 1 }`。
2. 跑世界檢查（第 7 節的指令）。耐打度不對時照比例改 `hp`（要 2.5 下、現在 1.8 下 → `hp × 2.5 / 1.8`）。
3. 每場掉的生命或勝率不對時改 `offense.all`。層主的勝率對 `offense` 很敏感，一次改 0.05～0.1。
4. `offense.all` 到上限（小怪 4、層主 7）還不夠時，提高 `ap`（每次 +1）或加傷害技能。
5. 邊改邊查用 `WORLD_TRIALS=6`，最後用預設的場數再跑一次（小怪 20 場）。層主戰的勝率雜訊大（20 場的誤差約 ±9%，和容許範圍差不多），所以不論 `WORLD_TRIALS` 設多少都至少打 40 場；場數少於 20 的快速模式下，層主勝率超出範圍只列成提醒，以預設場數的結果為準。

**最後以 [balance/monsters.md](../balance/monsters.md) 的平衡檢查為準**：世界檢查沒有錯誤才算完成。

### 2.2 出現地點（`spawns`、`exclude`）

`spawns` 的每一項是遭遇表裡的**一組**：`count` 隻同一種怪物。遭遇時從表裡的所有組平均抽一組。

| 欄位 | 範圍 | 說明 |
|---|---|---|
| `table` | 下表的 key | 不存在的 key 整項拿掉 |
| `count` | 整數 1～6（預設 1） | 一組幾隻 |
| `weight` | 整數 1～5（預設 1） | 放幾組（同一組重複放 N 次，越多越常遇到）。1 不用寫；`boss:` 不收 |
| `guards` | `[["<怪物 id>", 1～4], …]`，最多 2 種 | 只有 `boss:`：層主的護衛。內建或同一個檔案裡的怪物，不能是自己。不寫＝層主單獨出場 |

| `table` | 例 | 說明 |
|---|---|---|
| `wild:<地區>` | `wild:central` | 城郊（城鎮近郊）。地區：`central`、`north`、`south`、`forest`、`east_sea`、`west` |
| `dungeon:<地下城>:<層>` | `dungeon:snake_creek:outskirts` | 地下城的一般遭遇。層：`outskirts` 周邊、`shallow` 淺層、`middle` 中層、`deep` 深層、`abyss` 底層 |
| `boss:<地下城>:<層>` | `boss:ember_rift:shallow` | **取代**那一層的層主。層：`shallow`、`middle`、`deep`、`abyss` |

地下城 id（`data/world/geography.json`，16 座都有底層）：中央平原 `whisper_crypt`、`snake_creek`、`mist_abbey`；北境群山 `redemption_pit`、`echo_rift`、`giants_spine`；南境枯萎荒原 `ember_rift`、`bloodrock_cave`、`hell_greenhouse`；古樹森林 `moonshadow_roots`、`thorn_corridor`、`verdant_hollow`；東海群島 `tidefall_cave`、`skull_isle`；西部荒野 `echo_canyon`、`quicksand_temple`。

```json
"spawns": [
  { "table": "wild:forest", "count": 2 },
  { "table": "dungeon:moonshadow_roots:middle", "count": 1, "weight": 2 }
]
```

- 一組只能是同一種怪物；內建表裡「A＋B」的混合組合做不出來。
- 城郊的表有 6～10 組（中央平原 10 組，其他地區 6～7 組），`weight: 1` 大約是七到十一分之一的機會。
- **層主**：`boss:` 把那一層原本的整組（層主＋護衛）換成 `count` 隻這種怪物，**原本的護衛不會留下**。一般寫 `count: 1`；寫 2 就是兩隻都算層主。要護衛就加 `guards`（例 `"guards": [["hellhound", 2]]`）；層主戰的目標勝率是照單獨出場定的，加了護衛一定要重跑檢查、照結果降低層主的 `offense`。放在 `boss:` 的怪物就是層主（[COMBAT_SYSTEM](../../docs/COMBAT_SYSTEM.md) 8.3 節「層主」：不逃跑、控制最多 1 回合），平衡檢查也照層主算；同一隻不要同時放在一般遭遇表。
- 同一座地下城的同一層只能有一隻層主；兩隻怪物都寫同一個 `boss:` 時，後面的蓋掉前面的。
- 平衡模擬看怪物出現的**最淺**區域（城郊 → 周邊 → 淺層 → 其他）決定測試隊伍的人數，所以同一隻小怪同時放城郊與中層，是照城郊的目標調。
- `exclude`：修改內建怪物時，寫遭遇表的 key（`wild:…`、`dungeon:…`）把牠從內建的表拿掉；遭遇表不會被清空（拿掉會變空時不拿）。不能用來拿掉層主（層主用別的怪物的 `boss:` 取代）。

### 2.3 掉落（`loot`）

| 欄位 | 範圍 | 說明 |
|---|---|---|
| `item` | 字串，最多 30 字 | **物品的名稱**（中文），內建或同一個檔案的 `items` 裡要有 |
| `chance` | 0～1，小數 2 位（預設 0.5） | 每次打倒時掉的機率。0 的整項拿掉 |
| `qty` | 整數 1～20（預設 1） | 掉幾個。1 不用寫 |

- 物品的名稱**整理時不檢查**，打錯字也不會被報出來，打倒時會拿到一個無法使用的雜物。寫之前對照 `data/rules/items.json` 或自己的 `items`。
- 掉落的設定存在怪物身上：在物品那邊設定「怪物掉落」，改的也是這裡。
- 習慣：小怪掉一種本身的材料（40～60%）；層主掉一件專屬物品（100%）加上高價材料，怪物型層主可以掉打造材料（精鋼錠、秘銀礦石、龍皮……，機率低）。持有裝備的人形怪物另外寫 `armed`。

### 2.4 特徵、種類、發情

- `traits`：一定帶著的特徵，開戰時再另外擲 0～2 個隨機特徵（COMBAT_SYSTEM 8.2 節）。可以用的 id：`wounded` 受傷、`huge` 巨大、`agile` 敏捷、`rut` 發情、`enraged` 暴怒、`hungry` 飢餓、`cunning` 狡猾、`armored` 硬殼、`old` 年老、`young` 年幼、`timid` 怯懦、`frenzied` 嗜血。不存在的 id 拿掉。互斥的特徵（巨大與年幼、年老與年幼、暴怒與怯懦）不要寫在一起。
- 寫在 `traits` 的特徵會改變層主戰的結果（巨大：生命 ×1.5、傷害 +2），但不算進耐打度的模擬。
- `kind` 是種類；人形又會用武器的才寫 `armed`。
- `rut: true`：隨機特徵可能擲到「發情」。只對野獸、魔族這類合理的怪物寫。

### 2.5 技能（`abilities`、`ability_hp_below`）

- 怪物用的技能多半是 `classes` 含 `monster` 的能力（COMBAT_SYSTEM 第 9 節「怪物技能」），也可以用職業技能與戲法；**法術不行**。自建技能的寫法見 [abilities](abilities.md)。
- 技能的屬性（`attr`）用怪物自己的屬性；`casting` 對怪物是信仰。`scale` 依怪物的等級加骰。
- AI 怎麼挑技能見 COMBAT_SYSTEM 8.3 節：治療只在同伴生命低於六成時用、增益身上已經有的不再上、範圍技能敵人越多越想用。
- `ability_hp_below`：`{ "技能 id": 40 }` 表示生命 ≤ 40% 才能用，解開之後 AI 比較想用。內建層主都有一招 40% 的低血大招（每場一次）：物理的用 `frenzy_flurry` 狂暴亂舞或 `earthshatter` 崩地重擊，其他屬性用對應的範圍技（`world_pyre` 火、`eternal_frost` 冰、`thunder_judgement` 閃電、`sky_roar` 雷鳴、`venom_burst` 毒、`acid_deluge` 酸、`dirge_of_the_dead` 暗影、`heavens_wrath` 神聖、`arcane_collapse` 奧術、`mind_shatter` 心靈）。

## 3. 可以引用什麼

| 欄位 | 引用 | 要先存在 |
|---|---|---|
| `abilities`、`ability_hp_below` | 能力 id | 內建能力，或同一個檔案 `abilities` 裡的（不能是法術） |
| `loot[].item` | 物品名稱 | 內建物品，或同一個檔案 `items` 裡的（整理時不檢查；不存在時世界檢查會提醒） |
| `traits` | 特徵 id | `data/rules/monster_traits.json`（不能新增） |
| `weapon.type`、`resist`、`offense` 的 key | 傷害屬性與群組 | `data/rules/damage_types.json`（不能新增） |
| `spawns[].table`、`exclude` | 遭遇表 | 現有的地區與地下城（不能新增） |

被引用：特殊任務的戰鬥（[stories](stories.md)）、特殊地圖的遭遇表（[special-maps](special-maps.md)，一組最多 4 種怪物）、旅途事件與情報，以及存檔裡的委託與地圖格子。改 id 前先確認沒有人用到（[CONTENT_DEPENDENCIES](../../docs/CONTENT_DEPENDENCIES.md) 第 1 節）。

## 4. 最小範例

城郊的小怪：只寫必要的欄位與一個出現地點。

```json
"mod_enemy_cinder_rat": {
  "custom": true,
  "name": "煤渣鼠",
  "level": 2,
  "kind": "beast",
  "attrs": { "str": 8, "dex": 14, "int": 2, "fai": 10, "cha": 4 },
  "hp": 15,
  "ap": 3,
  "weapon": { "dice": "1d6", "type": "piercing", "attr": "dex" },
  "evade": 0,
  "dr": 0,
  "offense": { "all": -0.1 },
  "xp": 50,
  "loot": [{ "item": "鼠皮", "chance": 0.5 }],
  "spawns": [{ "table": "wild:central", "count": 2 }]
}
```

世界檢查的結果：挨 2.2 下、兩隻一組讓 1 人隊伍掉 27% 的生命，都在城郊的範圍內。

## 5. 完整範例

取代餘燼裂隙淺層層主的幼龍（南境 +3，淺層層主 6 級）：抗性與弱點、疊加的攻擊加成、自建技能（`mod_ability_ash_spit`，見 [abilities](abilities.md) 的最小範例）＋內建技能、低血大招、金錢與掉落、固定特徵。

```json
"mod_enemy_ash_wyrm": {
  "custom": true,
  "name": "灰燼幼龍",
  "level": 6,
  "kind": "beast",
  "attrs": { "str": 16, "dex": 14, "int": 8, "fai": 12, "cha": 10 },
  "hp": 260,
  "ap": 6,
  "weapon": { "dice": "2d8", "type": "slashing", "attr": "str" },
  "evade": 1,
  "dr": 2,
  "resist": { "fire": -1, "cold": 0.5 },
  "offense": { "all": 0.95, "fire": 0.5 },
  "abilities": ["mod_ability_ash_spit", "fire_breath", "world_pyre"],
  "ability_hp_below": { "world_pyre": 40 },
  "xp": 600,
  "money_cc": [150, 400],
  "loot": [
    { "item": "硬化獸皮", "chance": 0.8, "qty": 2 },
    { "item": "地獄犬牙", "chance": 0.5 },
    { "item": "龍皮", "chance": 0.15 }
  ],
  "rut": true,
  "traits": ["huge"],
  "desc": "在餘燼裂隙的熔岩邊孵化的幼龍，鱗片還帶著灰，吐息已經能把鐵熔軟。",
  "spawns": [{ "table": "boss:ember_rift:shallow", "count": 1 }]
}
```

- `offense`：普通攻擊（斬擊）×1.95，火焰的技能 ×2.45。
- `resist`：火焰免疫、寒冰弱點 ×1.5。
- 世界檢查的結果（層主戰 20 場時量的）：3.2 回合打得倒；層主戰勝率 80%（淺層目標 80%）。`offense.all` 1.0 時 75%、0.8 時 100%，所以一次只改一點。
- 層主戰現在至少打 40 場，數字會和上面略有不同；快速模式（`WORLD_TRIALS=6`）超出範圍只是提醒，以預設場數的結果為準。
- 原本的層主（地獄犬首領）和護衛不會再出現在這一層（要護衛就寫 `guards`，見 2.2 節）。

## 6. 常見錯誤

整理（`sanitizeEnemy`）時默默改掉的，世界檢查會在「整理時改了」列出來：

| 寫法 | 結果 |
|---|---|
| `offense` 某個 key 大於 7、`resist` 某個 key 大於 2，或小於 -1 | 夾到範圍內 |
| `offense`、`resist` 的 key 拼錯（`slash`、`magic`） | 那個 key 拿掉 |
| 值寫 0（`"fire": 0`） | 拿掉（沒有影響） |
| `weapon.dice` 寫 `1d6-1`、`d8`、`1d6+1d4` | 變成 `1d6` |
| `abilities` 放了法術、不存在的 id | 拿掉 |
| `ability_hp_below` 的技能不在 `abilities` 裡 | 拿掉；值 0 變 1、100 以上變 99 |
| `loot` 的 `chance` 是 0 | 整項拿掉；大於 1 變 1 |
| `loot` 的物品名稱打錯 | 整理時不拿掉，世界檢查會提醒「掉落不存在」；不改的話打倒時拿到沒有定義的物品 |
| `money_cc` 只寫一個數、或 `[0, 0]` | 拿掉 |
| `kind` 不在 9 種裡 | 拿掉 |
| `traits` 有不存在的特徵 | 那一個拿掉 |
| `armed`、`rut` 寫 `false` | 拿掉（不需要就不要寫） |
| `spawns` 的 `table` 不存在（`wild:default`、`dungeon:snake_creek:boss`、拼錯的地下城） | 整項拿掉；`count` 夾在 1～6、`weight` 夾在 1～5 |
| `boss:` 寫了 `weight`；`guards` 寫在一般遭遇表、超過 2 種、是自己或不存在的怪物、數量超出 1～4 | `weight` 與不合的護衛拿掉、多的截掉、數量夾住 |
| `level` 大於 30、`hp` 大於 9999、`ap` 大於 12、屬性大於 30 | 夾到上限 |
| `name` 超過 20 字、`desc` 超過 200 字 | 截斷 |
| 項目裡的 `id` 和 key 不同 | 改成 key |

其他要注意的：

- 只放進 `exclude` 而沒有 `spawns` 的新怪物遇不到。
- 新怪物和內建怪物同名、或兩隻自建的同名，世界檢查會提醒。
- 層主加了 `guards` 之後，平衡模擬也會連護衛一起打：勝率會下降，要重新調層主的 `offense`。

## 7. 相關的系統文件

- [MONSTERS](../../docs/MONSTERS.md)：內建怪物一覽、耐打度與輸出的目標、層主戰的結果。
- [COMBAT_SYSTEM](../../docs/COMBAT_SYSTEM.md)：第 3～6 節命中、豁免、傷害倍率；8.2 節特徵；8.3 節敵人 AI 與層主；第 9 節怪物技能。
- [DUNGEON_DESIGN](../../docs/DUNGEON_DESIGN.md)：地下城各層的遭遇。
- [ITEMS](../../docs/ITEMS.md) 第 1 節：掉落與持有裝備的機率。
- [CONTENT_EDITOR](../../docs/CONTENT_EDITOR.md) 第 1 節、[CONTENT_DEPENDENCIES](../../docs/CONTENT_DEPENDENCIES.md)：編輯畫面、刪除與引用。
- [abilities](abilities.md)：自建技能。[balance/monsters.md](../balance/monsters.md)：平衡檢查（最後的標準）。
- 檢查：`WORLD=<檔案> WORLD_TRIALS=6 npx vitest run src/__tests__/worldCheck.spec.ts`，報告在同一個資料夾的 `check-report.md`。
