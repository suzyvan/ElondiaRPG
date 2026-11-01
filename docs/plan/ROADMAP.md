# 未來計畫

> 上層：[計畫與追蹤](README.md)。
> 這裡記**已經決定要做**、還沒做完的事，包括不影響遊戲的程式整理。還沒決定要不要做的構想放在 [點子庫](ideas/README.md)。
> 細節多的項目在 [`roadmap/`](roadmap/) 另開一份計畫，只寫還沒做的部分。做完之後從這裡刪掉，在 [已完成](roadmap/COMPLETED.md) 記一段；新增的功能同時寫進 [CHANGELOG](../../CHANGELOG.md) 的「未發布」。

## 1. 遊戲

| # | 項目 | 現況 | 細節 |
|---|---|---|---|
| R1（原 D1） | **數值平衡**：生命值、行動點、傷害、經驗值、報酬，以及慾望戰鬥的係數 | 都是起始值，要實際遊玩後調整（高階委託的問題見 [LOGIC_ISSUES](LOGIC_ISSUES.md) L1；慾望戰鬥要調的數值見 R8 的計畫第 3 節） | [GAME_DESIGN](../GAME_DESIGN.md)、[worldgen/balance/](../../worldgen/balance/README.md) |
| R8（原 I14） | **慾望戰鬥的收尾**（成人向）：神殿的淨化、聲望交叉與「放蕩的貴族」、流派的老師與秘法書、寄生類的雙面效應、園區規則的編輯器、新園區、防具的淫器合煉 | S0～S9 已在 v0.4.0 發布；剩下的都還沒開始 | [roadmap/LUST_COMBAT_PLAN](roadmap/LUST_COMBAT_PLAN.md) |
| R9 | **角色線：白百合巡禮（奧菈莉婭＆格溫德琳）、全城跑最快的精靈（琥珀）**：陰柔、中性形象的固定角色還沒有角色線的補上；各四個任務（一～三非成人向，四成人向） | 規劃完成（2026-10-30），還沒做成資料；有三個待決定（計畫第 5 節） | [roadmap/CHARACTER_LINES_PLAN](roadmap/CHARACTER_LINES_PLAN.md) |
| R12 | **高等地下城（Lv.13～20）**：歷史裂縫、歷史迴廊、禁果庭園（成人向）、歡愉秘宮（成人向） | 決定要做（2026-10-31），還沒開始；Lv.14～20 目前沒有能反覆打的地方 | [roadmap/HIGH_DUNGEONS_PLAN](roadmap/HIGH_DUNGEONS_PLAN.md) |
| R13 | **特殊任務與事件的時段：套用到內建內容**：夜裡的場景只在夜裡觸發、夜裡的事件結束後推到隔天早上（不會在大白天看到月亮） | 功能與內建內容都完成（2026-10-31：147 個任務點的時段、226 個結果的時間、事件 27 個結果；「三天後取件」這類改用新條件「幾天之後」）；剩下事件本身的時段（計畫第 8 節） | [roadmap/STORY_TIME_PLAN](roadmap/STORY_TIME_PLAN.md) |

## 2. 介面與工具

| # | 項目 | 現況 | 細節 |
|---|---|---|---|
| R10 | **手機版畫面**：實機測試、已知的小問題 | M1～M4 已完成並合併（2026-10-30，規則見 [MOBILE_UI](../MOBILE_UI.md)）；等實機測試 | [roadmap/MOBILE_UI_PLAN](roadmap/MOBILE_UI_PLAN.md) |
| R11 | **世界編輯器**：局部匯入／匯出（有關聯就一起帶）、特殊任務流程圖、AI 特殊任務生成器 | E5 介面整理、E1 關聯、E2 局部匯入與匯出、E3 流程圖、E4 特殊任務生成器完成（剩小項目） | [roadmap/WORLD_EDITOR_PLAN](roadmap/WORLD_EDITOR_PLAN.md) |

UI v2 已完成（原 R2）；沒做的模組化像素立繪、地圖格 tileset 移到點子庫 I19、I20。

## 3. 程式整理

不影響遊戲行為，有空時處理。目前沒有。開發流程的建議（CI、可達性檢查、存檔的穩定 id……）在 [RETROSPECTIVE](RETROSPECTIVE.md) 第 12 節，還沒決定要不要做。
