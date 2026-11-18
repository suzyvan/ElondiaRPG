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

`roadmap/` 目前有：[WORLD_EDITOR_PLAN](roadmap/WORLD_EDITOR_PLAN.md)（R11）、[EAST_CONTINENT_PLAN](roadmap/EAST_CONTINENT_PLAN.md)、[EAST_CONTENT_PLAN](roadmap/EAST_CONTENT_PLAN.md)（R15，已完成，留作設計紀錄）、[PREGNANCY_PLAN](roadmap/PREGNANCY_PLAN.md)（R28，已完成，留作設計紀錄）、[AGENT_MODE_PLAN](roadmap/AGENT_MODE_PLAN.md)（R29）、[STORAGE_PLAN](roadmap/STORAGE_PLAN.md)（R30，已完成，留作設計紀錄）、[HOUSEHOLD_STAFF_PLAN](roadmap/HOUSEHOLD_STAFF_PLAN.md)（R31，已完成，留作設計紀錄）、[HOME_EXPANSION_PLAN](roadmap/HOME_EXPANSION_PLAN.md)（R32，已完成，留作設計紀錄）、[COMPLETED](roadmap/COMPLETED.md)（已完成）。

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
