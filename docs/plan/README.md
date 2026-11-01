# 計畫與追蹤

> 上層：[文件地圖](../README.md)。這個資料夾放**還沒做完的事**；系統文件（`docs/` 底下其他文件）只描述程式現在的行為。

## 1. 放在哪裡

這個資料夾只放五份文件，加上兩個子目錄：

| 文件 | 放什麼 | 編號 | 判斷方式 |
|---|---|---|---|
| [BUGS](BUGS.md) | Bug | B | 程式**沒有照規則或文件**運作：出錯、當掉、算錯、資料讀錯、畫面和實際結果不一致 |
| [LOGIC_ISSUES](LOGIC_ISSUES.md) | 業務邏輯問題 | L | 程式照設計運作，但**規則本身不合理**：玩家沒東西可做、數值可以濫用、流程有漏洞、系統之間互相矛盾 |
| [ROADMAP](ROADMAP.md) | 未來計畫 | R | **已經決定要做**、還沒做完的事（含不影響遊戲的程式整理） |
| [RETROSPECTIVE](RETROSPECTIVE.md) | 開發回顧：問題盤點 | — | 開發以來遇到的問題、原因、防範與建議（2026-10-30） |
| README（這份） | 分類與流程 | — | — |
| [roadmap/](roadmap/) | ROADMAP 項目的細節計畫，以及[已完成](roadmap/COMPLETED.md)的紀錄 | 計畫內自己的編號（S、M、E……） | 一個 R 項目細節太多時另開一份，只寫還沒做的部分 |
| [ideas/](ideas/README.md) | 點子庫（依來源分成不同文件） | I | **還沒決定要不要做**的構想 |

`roadmap/` 目前有：[LUST_COMBAT_PLAN](roadmap/LUST_COMBAT_PLAN.md)（R8）、[CHARACTER_LINES_PLAN](roadmap/CHARACTER_LINES_PLAN.md)（R9）、[MOBILE_UI_PLAN](roadmap/MOBILE_UI_PLAN.md)（R10）、[WORLD_EDITOR_PLAN](roadmap/WORLD_EDITOR_PLAN.md)（R11）、[HIGH_DUNGEONS_PLAN](roadmap/HIGH_DUNGEONS_PLAN.md)（R12）、[STORY_TIME_PLAN](roadmap/STORY_TIME_PLAN.md)（R13，附 `story_time_audit.json`）、[COMPLETED](roadmap/COMPLETED.md)（已完成）。

## 2. 流程

```
發現問題 ─┬─ 程式沒照規則 ──────────→ BUGS ──── 修好 ─┐
          └─ 規則本身不合理 ─→ LOGIC_ISSUES ─ 決定怎麼改 ─┤
有構想 ────→ ideas ─ 決定要做 ─→ ROADMAP ─────── 做完 ─┤
                                                       ↓
              結論寫回系統文件 → 從清單刪掉 → 在 roadmap/COMPLETED 記一段
                              （玩家看得到的改動也寫進 CHANGELOG 的「未發布」）
```

- 編號不重複使用：刪掉的項目編號空著，新項目接著往下編。從舊文件搬來的項目在編號後面註明原本的編號（例如「L1（原 D8）」）。
- 不確定是不是 Bug 的，放在 BUGS 的「待確認」。
- 系統文件裡不寫「待決定」「之後再做」，改成連到這裡的編號。
