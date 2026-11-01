# 技能（`abilities`）

> 新增或修改能力：玩家的技能、法術、戲法，以及怪物用的技能。檔案的外層與 id 規則見 [content-file](content-file.md)。
> 系統文件：[COMBAT_SYSTEM](../../docs/COMBAT_SYSTEM.md)（第 2 節行動點與法術環、第 3～6 節命中、幸運一擊、豁免、傷害倍率、第 7 節技能法術戲法、第 8 節狀態、第 9 節各職業與怪物的能力清單）、[CONTENT_EDITOR](../../docs/CONTENT_EDITOR.md) 3.5 節（編輯畫面）。程式：`src/engine/mods.ts` 的 `sanitizeAbility`、`damagePart`、`applyDef`（整理），`src/engine/combat.ts` 的 `useAbility`（結算），`src/engine/character.ts` 的 `learnable`（學習）；資料 `data/rules/abilities.json`。

## 1. 用途與放在哪裡

- 區塊：`content.abilities`，key 是能力的 id。
- **新的能力**：id 用 `mod_ability_<英文小寫>`（例：`mod_ability_ember_lance`），加 `"custom": true`。
- **修改內建的能力**：用原本的 id（查 `data/rules/abilities.json`），不加 `custom`，寫整份修改後的資料。內建能力被職業的初始能力、怪物、固定 NPC 與存檔的角色用到，改了全部一起變。
- 項目裡可以不寫 `id`；寫的話要和 key 一樣。
- 同一份資料有四種用途：
  - **玩家與 NPC 的技能**（`type: skill`）：到了 `unlock` 級，升級時可能抽到。
  - **法術**（`type: spell`）：有 `circle` 環的法術環時可能抽到，施放時花一個該環以上的法術環。
  - **戲法**（`type: cantrip`）：不花行動點、每回合一次，可學數量有限。
  - **怪物技能**：`classes` 寫 `monster`，再把 id 放進怪物的 `abilities`（[monsters](monsters.md) 2.5 節）。怪物不能用法術。

### 1.1 職業怎麼學到

規則在 `character.ts` 的 `learnable`、COMBAT_SYSTEM 第 7 節：

- 每次升級從「這個職業可以學、還沒學會」的能力隨機抽 3 個讓玩家選一個（NPC 自動挑第一個）。
- `classes` 裡有這個職業才會出現。可以寫的職業：`fighter` 戰士、`barbarian` 野蠻人、`paladin` 聖騎士、`ranger` 遊俠、`rogue` 遊蕩者、`monk` 武僧、`bard` 吟遊詩人、`cleric` 牧師、`druid` 德魯伊、`wizard` 法師，加上 `monster`。
- **技能**：`unlock` ≤ 角色等級。品質依 `unlock`（1-4 普通、5-8 優良、9-12 稀有、13-16 史詩、17-20 傳說），也不能超過角色生命層級的上限，兩者剛好對齊，所以實際上就是到了等級就能抽到。
- **法術**：角色要有 `circle` 環的法術環。全施法者（吟遊詩人、牧師、德魯伊、法師）1 環 1 級、2 環 3 級、3 環 5 級、4 環 7 級、5 環 10 級、6 環 12 級、7 環 15 級、8 環 17 級、9 環 20 級起（`combat.json` 的 `spell_slots`）；半施法者（聖騎士、遊俠）用一半的等級查同一張表，最多 5 環（1 環 1 級、2 環 5 級、3 環 9 級、4 環 13 級、5 環 19 級）；戰士、野蠻人、遊蕩者、武僧沒有法術環，**給他們的法術永遠抽不到**。
- **戲法**：可學數量 = 2 + floor(等級 ÷ 4)，已經學滿就不會再抽到。
- 職業的初始能力（`classes.json` 的 `start`）不能用內容修改。特殊任務的「學會能力」效果（`ability`）只在角色目前學得到這個能力時（職業、等級或環數都符合）才學到它，**學不到時改成隨機給一個學得到的**。當任務報酬用的能力，`classes` 要列出主角可能的職業，`unlock` 或 `circle` 不要高過任務的等級。固定 NPC 的 `abilities` 可以直接指定任何能力。
- 生成的冒險者 NPC（夥伴、敵對的冒險者）也從同一份清單挑，**平衡模擬的測試隊伍也是**：替戰士、遊蕩者、牧師、法師加新能力，可能讓怪物的模擬結果跟著變（第 6 節）。

## 2. 欄位一覽

沒有寫的欄位用預設值；**寫了但不合規則的值會被默默改掉**（第 6 節）。

| 欄位 | 型別 | 範圍 | 說明 |
|---|---|---|---|
| `name` | 字串 | 最多 16 字 | 顯示的名字。空白時變成「新的能力」 |
| `type` | 字串 | `skill`、`spell`、`cantrip`（其他值變 `skill`） | 種類，見 1.1 節 |
| `classes` | 字串陣列 | 1.1 節的職業 id 與 `monster` | 誰可以學。`noncombatant` 與不認得的拿掉。只寫 `monster` 的玩家學不到 |
| `unlock` | 整數 | 1～20（預設 1） | 只有 `skill` 有：幾級可以學。其他種類寫了會被拿掉 |
| `circle` | 整數 | 1～9（預設 1） | 只有 `spell` 有：環數。其他種類寫了會被拿掉 |
| `ap` | 整數 | 0～12 | 行動點。沒寫時：技能 2、法術依環數（1-2 環 2、3-5 環 3、6-8 環 4、9 環 5）、戲法 0 |
| `attr` | 字串 | `str`、`dex`、`int`、`fai`、`cha`、`casting` | 命中、DC 與 `mod`（加屬性調整值）用的屬性。`casting` 是職業的施法屬性（不施法的職業用主屬性，怪物用信仰）。沒寫時用武器的屬性 |
| `threat` | 整數 | -50～50 | 使用時另外加減的仇恨（COMBAT_SYSTEM 8.1 節） |
| `target` | 字串 | 見下表（其他值變 `enemy`） | 目標 |
| `count` | 整數 | 1～10（預設 3） | 只有 `random_enemies` 有：打幾次（每次各自隨機挑，可能重複打同一人） |
| `resolve` | 字串 | `attack`、`save`、`auto`（**其他值變 `auto`**） | 判定方式：命中骰對迴避／目標豁免／必中（COMBAT_SYSTEM 第 3、5 節） |
| `save` | 字串 | 五種屬性（預設 `dex`） | 只有 `resolve: save` 有：目標用哪個屬性豁免。DC = 8 + 熟練 + `attr` 的調整值 |
| `on_save` | 字串 | `half`（預設）、`none` | 只有 `resolve: save` 有：豁免成功時傷害減半，或沒有傷害 |
| `damage` | 陣列 | 最多 4 段 | 傷害，見 2.2 節 |
| `mult` | 數字 | 0.1～5，小數 2 位 | 傷害倍率（例 0.75）。1 不用寫 |
| `hits` | 整數 | 1～6 | 對每個目標攻擊幾次（每次各自判定）。1 不用寫 |
| `hit` | 整數 | -10～10 | 命中修正（只對 `attack`） |
| `adv` | `true` | | 命中骰優勢 |
| `crit` | 整數 | 1～5 | 這一擊的幸運一擊閾值降低多少（COMBAT_SYSTEM 第 4 節） |
| `heal` | 物件 | 見 2.3 節 | 治療（只能用在 `resolve: auto`） |
| `shield` | 物件 | 見 2.3 節 | 臨時生命值（只能用在 `resolve: auto`） |
| `apply` | 陣列 | 最多 4 個 | 施加狀態，見 2.4 節 |
| `ap_gain` | 整數 | 1～10 | 使用後獲得的行動點 |
| `ap_gain_on_hit` | 整數 | 1～10 | 有命中時另外獲得的行動點 |
| `uses` | 物件 | `per_turn`、`per_combat`、`per_rest` 各 1～10 | 每回合、每場戰鬥、每次長休最多幾次（怪物的「每次長休」等於每場） |
| `concentration` | `true` | | 需要專注：同時只能維持一個，施放新的會取消舊的，受傷時信仰豁免（COMBAT_SYSTEM 第 7 節）。這個能力施加的狀態在專注中斷時消失 |
| `cleanse` | `true` | | 移除**目標**身上所有減益（只能用在 `resolve: auto`；目標是自己時就是淨化自己） |
| `lifesteal` | 數字 | 0.05～1，小數 2 位 | 回復造成傷害的這個比例 |
| `recover_slot` | `true` | | 回復一個用掉的法術環（最高到等級一半的環數；只能用在 `resolve: auto`）。沒有可回復的時候不能用 |
| `hp_limit` | 整數 | 1～9999 | 目標生命 ≤ 這個值時，狀態（`apply`）與 `kill` 才有效；不擋傷害 |
| `kill` | `true` | | 直接擊倒，要配合 `hp_limit`，只能用在 `resolve: auto` |
| `upcast` | 物件 | 見下面 | 只有 `spell` 有：升環，用比 `circle` 高的法術環施放時**每高一環**多的效果（COMBAT_SYSTEM 第 7 節）。內建的數值照 D&D 5e 的升環規則。沒寫時升環沒有效果。說明文字要自己寫上（內建的寫成「升環：每高一環傷害 +1d6。」） |
| `desc` | 字串 | 最多 200 字 | 玩家與 AI 看到的說明。照實際數值寫（骰子、回合、次數） |
| `custom` | `true` | | 新的能力要寫 |

`upcast` 的欄位（都是「每高一環」，可以同時寫好幾個）：

| 欄位 | 值 | 效果 |
|---|---|---|
| `dice` | 骰子（例 `1d6`） | 傷害多擲的骰子，加在 `damage` 的第 `part` 段（0 起算，預設 0）。和那一段面數一樣時直接加骰數（`8d6` 升 2 環變 `10d6`），面數不同或那一段是武器傷害時另外擲一段同屬性的 |
| `part` | 整數 | `dice` 加在第幾段（例：至聖斬的第 0 段是武器，寫 1） |
| `heal`、`heal_flat` | 骰子；整數 1～999 | 治療多擲的骰子、多的固定值（要有 `heal`） |
| `count` | 整數 1～5 | 隨機敵人多打幾次（要是 `random_enemies`） |
| `hits` | 整數 1～5 | 每個目標多攻擊幾次 |
| `shield` | 整數 1～999 | 多的臨時生命值（要有 `shield`） |
| `status_dice` | 骰子 | 施加的持續傷害（`dot`）、每回合攻擊（`pulse`）狀態每次多擲的骰子（月華光束、靈體武器） |

升環不多花行動點。條件不合的欄位（沒有傷害卻寫 `dice`、不是 `random_enemies` 卻寫 `count`……）整理時拿掉，不是法術的整個 `upcast` 拿掉。

布林欄位（`adv`、`concentration`、`cleanse`、`recover_slot`、`kill`、`heal.mod` 這類）只寫 `true`；數字欄位的 0 與預設值（`mult: 1`、`hits: 1`、`hit: 0`）不要寫：會被拿掉（`false`、0、空陣列等於沒寫，報告不會列；`mult: 1` 這類會列在報告裡）。

### 2.1 目標（`target`）

| 值 | 目標 | 說明 |
|---|---|---|
| `enemy` | 一名敵人 | |
| `all_enemies` | 所有敵人 | |
| `random_enemies` | 隨機敵人 `count` 次 | 每次重新挑，可能重複 |
| `ally` | 一名隊友 | 包括自己 |
| `ally_or_downed` | 一名隊友，可以選倒下的 | 搭配 `heal` 就是救起倒下的人 |
| `all_allies` | 所有隊友 | 包括自己 |
| `self` | 自己 | |

給隊友或自己的能力用 `resolve: auto`。

### 2.2 傷害（`damage`）

每一段：

| 欄位 | 範圍 | 說明 |
|---|---|---|
| `weapon` | `true` | 用武器傷害：武器骰 + 武器屬性的調整值 + 狀態的傷害加值，屬性是武器的（這一段的 `type`、`mod` 沒有作用） |
| `dice` | `XdY`、`XdY+Z`、`XdY-Z`（X 最多 2 位、Y 最多 3 位） | 骰子。和 `weapon` 二選一，兩個都沒有的整段拿掉 |
| `type` | 13 種傷害屬性的 id | 傷害屬性（見 [monsters](monsters.md) 第 2 節的列表）。沒寫時沿用武器的屬性 |
| `mod` | `true` | 加 `attr` 屬性的調整值 |
| `scale` | `{ dice, per }`：per 整數 1～20（預設 4） | 隨等級多加骰子：多 floor((等級 − 1) ÷ per) 組 `dice`。例 per 4：5、9、13、17 級各多一組 |

- 一次命中時每一段各擲一次再加起來，乘上 `mult`、攻擊加成與受傷倍率（COMBAT_SYSTEM 第 6 節），物理部分再扣防具減傷。
- 幸運一擊時骰子數量加倍（`scale` 的也加倍）；戲法在 5、11、17 級各多一倍骰數（`scale` 的不算）。
- 「武器攻擊＋額外 1d8」寫成兩段：`[{ "weapon": true }, { "dice": "1d8" }]`。

### 2.3 治療與護盾（`heal`、`shield`）

| 欄位 | 範圍 | 說明 |
|---|---|---|
| `heal.dice` | 骰子（同上） | 治療骰 |
| `heal.mod` | `true` | 加 `attr` 的調整值 |
| `heal.level` | `true` | 加施放者的等級 |
| `heal.flat` | 整數 1～999 | 固定值 |
| `heal.full` | `true` | 回滿（其他欄位不算） |
| `shield.flat` | 整數 1～999 | 臨時生命值的固定值 |
| `shield.level` | 整數 1～10 | 再加「這個數 × 等級」 |

- **`heal`、`shield`、`cleanse`、`recover_slot`、`kill` 只能用在 `resolve: auto`**：寫在 `attack` 或 `save` 的能力上會被拿掉（報告列成「整理時改了」）。要「打中再治療自己」改用 `lifesteal`，或拆成兩個能力。
- 臨時生命值不疊加，取較高的。

### 2.4 施加狀態（`apply`）

每一項：

| 欄位 | 範圍 | 說明 |
|---|---|---|
| `status` | 狀態 id | 內建（`data/rules/statuses.json`）或同一個檔案 `statuses` 裡的。不存在的整項拿掉 |
| `turns` | 整數 1～20（預設 2） | 持續回合（在擁有者的回合開始時 -1） |
| `to` | `target`（預設）、`self`、`allies`、`enemies` | 給誰。`allies` 包括自己。同一個狀態不疊加：再套一次只是取較長的回合 |
| `on` | `hit`、`fail`、`always` | 什麼時候。沒寫時依 `resolve`：`attack` 命中時、`save` 豁免失敗時、`auto` 一定。`attack`、`save` 的能力寫 `always` 時沒命中也會套上 |
| `save` | 五種屬性 | 套上之前目標再豁免一次（DC 同上），成功就不套。常用在「命中後力量豁免失敗則暈眩」 |
| `value` | `{ dice, mod, level, flat }`，flat -50～50 | 狀態的數值，只對「下一次物理傷害減去數值」的狀態（例 `deflecting` 偏轉）有用 |

常用的狀態 id：減益 `burning` 燃燒、`poisoned` 中毒、`bleeding` 流血、`exposed` 破綻、`frightened` 恐懼、`blinded` 致盲、`restrained` 束縛、`prone` 倒地、`stunned` 暈眩、`hindered` 妨礙、`chilled` 寒霜、`shocked` 電擊、`bane` 災禍、`confused` 困惑、`silenced` 沉默；增益 `blessed` 祝福、`inspired` 激勵、`defending` 防禦、`regen` 再生、`hasted` 加速、`stoneskin` 石膚、`deflecting` 偏轉。效果見 COMBAT_SYSTEM 第 8 節；要新的狀態先寫 `statuses`（[statuses-perks-tattoos](statuses-perks-tattoos.md)）。

### 2.5 數值的上限

世界檢查會比較**玩家能力**每行動點的傷害（武器骰算 1d8、所有敵人算 2 人、隨機目標最多算 3 次，在解鎖等級或「環數 × 2 − 1」級計算；行動點用遊戲裡實際的消耗：沒寫 `ap` 時技能 2、法術依環數、戲法算 1），不能超過內建同一級（同一環的法術、同兩級的技能、戲法）最強的 1.25 倍。`classes` 含 `monster` 的不比，由使用它的怪物的模擬檢查。細節與怎麼調見 [balance/abilities.md](../balance/abilities.md)。

## 3. 可以引用什麼

| 欄位 | 引用 | 要先存在 |
|---|---|---|
| `apply[].status` | 狀態 id | 內建狀態，或同一個檔案 `statuses` 裡的 |
| `damage[].type` | 傷害屬性 | `data/rules/damage_types.json`（不能新增） |
| `classes` | 職業 | `data/rules/classes.json`（不能新增） |

被引用：怪物的 `abilities`、`ability_hp_below`（[monsters](monsters.md)）、固定 NPC 的 `abilities`（[npcs](npcs.md)）、特殊任務的「學會能力」效果（[stories](stories.md)），以及存檔裡角色學會的能力。被拿掉的能力會從存檔的角色身上拿掉（[CONTENT_DEPENDENCIES](../../docs/CONTENT_DEPENDENCIES.md)）。

## 4. 最小範例

怪物用的技能（[monsters](monsters.md) 的完整範例用到它）：

```json
"mod_ability_ash_spit": {
  "custom": true,
  "name": "灰燼唾沫",
  "type": "skill",
  "classes": ["monster"],
  "ap": 2,
  "attr": "dex",
  "target": "enemy",
  "resolve": "attack",
  "damage": [{ "dice": "1d6", "type": "fire" }],
  "apply": [{ "status": "burning", "turns": 2, "on": "hit" }],
  "desc": "吐出一口帶火星的灰燼：1d6 火焰傷害，命中後燃燒 2 回合。"
}
```

## 5. 完整範例

法師與德魯伊的 3 環法術：命中修正、加屬性調整值、隨等級加骰、兩個狀態（一個要另外豁免）、使用次數、額外仇恨。`ap` 沒寫，依環數是 3。

```json
"mod_ability_ember_lance": {
  "custom": true,
  "name": "餘燼長槍",
  "type": "spell",
  "circle": 3,
  "classes": ["wizard", "druid"],
  "attr": "casting",
  "target": "enemy",
  "resolve": "attack",
  "hit": 1,
  "damage": [{ "dice": "3d8", "type": "fire", "mod": true, "scale": { "dice": "1d8", "per": 4 } }],
  "apply": [
    { "status": "burning", "turns": 2, "on": "hit" },
    { "status": "exposed", "turns": 1, "on": "hit", "save": "dex" }
  ],
  "uses": { "per_combat": 2 },
  "threat": 5,
  "desc": "凝成長槍的餘燼：命中 +1，3d8 + 施法屬性調整值火焰傷害，每 4 級再 +1d8；命中後燃燒 2 回合，目標靈巧豁免失敗再露出破綻 1 回合。每場戰鬥兩次。"
}
```

其他常見的寫法（都通過世界檢查）：

治療隊友並淨化（牧師、聖騎士 5 級技能）：

```json
"mod_ability_ash_mending": {
  "custom": true,
  "name": "拂灰療傷",
  "type": "skill",
  "unlock": 5,
  "classes": ["cleric", "paladin"],
  "ap": 2,
  "attr": "fai",
  "target": "ally",
  "resolve": "auto",
  "heal": { "dice": "2d8", "mod": true, "level": true },
  "cleanse": true,
  "uses": { "per_combat": 1 },
  "desc": "拂去隊友身上的灰燼：回復 2d8 + 信仰調整值 + 等級 HP，並移除負面狀態。每場戰鬥一次。"
}
```

戲法（不花行動點，隨機目標）：

```json
"mod_ability_spark": {
  "custom": true,
  "name": "火星",
  "type": "cantrip",
  "classes": ["wizard"],
  "attr": "casting",
  "target": "random_enemies",
  "count": 2,
  "resolve": "auto",
  "damage": [{ "dice": "1d4", "type": "fire" }],
  "desc": "彈出兩顆火星，隨機打中敵人，各 1d4 火焰傷害（必中）。5、11、17 級骰數加倍。"
}
```

給自己的護盾與帶數值的狀態（武僧 3 級技能）：

```json
"mod_ability_ember_guard": {
  "custom": true,
  "name": "餘燼護身",
  "type": "skill",
  "unlock": 3,
  "classes": ["monk"],
  "ap": 1,
  "attr": "dex",
  "target": "self",
  "resolve": "auto",
  "shield": { "flat": 3, "level": 1 },
  "apply": [{ "status": "deflecting", "turns": 3, "to": "self", "value": { "dice": "1d6", "mod": true } }],
  "uses": { "per_turn": 1 },
  "desc": "以餘燼裹住身體：獲得 3 + 等級臨時生命值，下一次物理傷害減去 1d6 + 靈巧調整值。每回合一次。"
}
```

## 6. 常見錯誤

整理（`sanitizeAbility`）時默默改掉的，世界檢查會在「整理時改了」列出來：

| 寫法 | 結果 |
|---|---|
| `type` 拼錯（`power`、`magic`） | 變成 `skill` |
| `resolve` 拼錯（`check`、`hit`） | 變成 **`auto`（必中）** |
| `target` 拼錯（`everyone`、`allies`） | 變成 `enemy` |
| `skill` 寫了 `circle`、`spell` 寫了 `unlock`、`cantrip` 寫了任何一個 | 拿掉 |
| 不是 `random_enemies` 卻寫了 `count` | 拿掉 |
| 不是 `resolve: save` 卻寫了 `save`、`on_save` | 拿掉（要「命中後再豁免」用 `apply[].save`） |
| `classes` 有 `noncombatant` 或不認得的 | 拿掉 |
| 骰子有空白（`"2d6 + 1"`） | 去掉空白（列在報告裡）；`heal.dice`、`scale.dice`、`apply[].value.dice` 有空白時整個拿掉 |
| 骰子格式不對（`2d6+1d4`、`d100+1000`） | 那一段傷害整段拿掉 |
| `apply` 的 `status` 不存在 | 整項拿掉；`to`、`on` 拼錯的拿掉（用預設） |
| `turns` 大於 20、`uses` 大於 10、`hits` 大於 6、`mult` 大於 5、`lifesteal` 大於 1、`shield.level` 大於 10 | 夾到上限 |
| `mult: 1`、`hits: 1`、`hit: 0`、`crit: 0`、`uses.per_turn: 0`、`adv: false` | 拿掉（不要寫預設值） |
| `heal`、`shield`、`cleanse`、`recover_slot`、`kill` 寫在 `resolve: attack` 或 `save` 的能力上 | 拿掉（只能用在 `auto`） |
| 超過 4 段傷害、4 個狀態 | 多的拿掉 |
| `name` 超過 16 字、`desc` 超過 200 字 | 截斷 |

整理時不會改、但戰鬥裡沒有作用的：

- `weapon: true` 那一段寫了 `type` 或 `mod`：武器段永遠用武器的屬性與調整值。要「武器攻擊＋火焰傷害」就另外加一段 `{ "dice": "1d6", "type": "fire" }`。
- `kill` 沒有 `hp_limit`。
- `value` 給了不是「減去數值」的狀態。
- 戰士、野蠻人、遊蕩者、武僧的法術：學不到。
- 怪物的 `abilities` 放法術：整理怪物時拿掉。

其他要注意的：

- 給戰士、遊蕩者、牧師、法師的新能力會進到平衡模擬的測試隊伍，怪物的模擬結果可能跟著變；加完能力後整個世界再檢查一次。
- 怪物技能不比傷害上限，但太強的會讓使用它的怪物過不了平衡（[balance/monsters.md](../balance/monsters.md)）。

## 7. 相關的系統文件

- [COMBAT_SYSTEM](../../docs/COMBAT_SYSTEM.md)：第 2 節行動點與法術環、第 3～6 節判定與傷害、第 7 節種類與學習、第 8 節狀態、8.3 節敵人 AI 怎麼挑技能、第 9 節各職業與怪物的能力清單（寫新能力前先看同職業、同等級的內建能力）。
- [CONTENT_EDITOR](../../docs/CONTENT_EDITOR.md) 3.5、3.55 節：能力與狀態的編輯畫面。
- [CONTENT_DEPENDENCIES](../../docs/CONTENT_DEPENDENCIES.md)：引用與刪除。
- [monsters](monsters.md)（怪物怎麼用技能）、[statuses-perks-tattoos](statuses-perks-tattoos.md)（自建狀態）、[balance/abilities.md](../balance/abilities.md)（平衡檢查）。
- 檢查：`WORLD=<檔案> WORLD_TRIALS=6 npx vitest run src/__tests__/worldCheck.spec.ts`，報告在同一個資料夾的 `check-report.md`。
