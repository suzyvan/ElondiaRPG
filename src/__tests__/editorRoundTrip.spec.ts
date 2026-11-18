// @vitest-environment jsdom
// 世界編輯器的來回測試（說明見 editorRoundTrip.ts）。分成幾個檔案：每個檔案一個 worker，記憶體才夠。
import { roundTripSuite } from './editorRoundTrip'

roundTripSuite(...['enemies', 'items', 'bases', 'materials', 'abilities', 'statuses', 'conditions', 'perks', 'npcTags', 'classes', 'tattoos', 'marks', 'parasites', 'rules', 'markRules', 'bindRules', 'family', 'homes'])
