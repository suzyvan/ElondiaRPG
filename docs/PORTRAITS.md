# 角色形象插圖

> 上層：[GAME_DESIGN](GAME_DESIGN.md)。依賴：[PROMPTS](PROMPTS.md)（預處理用的模型來源與功能分配）、[SAVES](SAVES.md)（匯出、匯入、清理）。
> 程式：`src/narrator/imageInfo.ts`（服務模板、提示詞、預處理指示）、`src/narrator/imageProviders.ts`（送出請求）、`src/narrator/imageUtils.ts`（縮放底圖、遮罩）、`src/narrator/sceneInfo.ts`（日誌插圖的分鏡）、`src/stores/image.ts`（設定）、`src/stores/portraits.ts`（保存與生成）、`src/stores/scenes.ts`（日誌插圖）、`src/components/ImageSettings.vue`、`src/components/PortraitBox.vue`、`src/components/PortraitStudio.vue`、`src/components/SceneImage.vue`。

隊伍視窗的每位成員、人際關係裡登場過的人都有一格形象圖：可以「🎨 生成形象圖」、「📁 上傳」自己的圖片、刪除，點圖片放大。

**內建形象圖**：部分固定 NPC 附有內建的形象圖（`src/assets/portraits/<npc id>.webp`，目前 54 位）。
- 還沒有自己的圖時顯示內建圖（形象圖框、小頭像都是），框下面寫「內建形象圖」。
- 生成或上傳之後換成自己的圖；刪掉自己的圖會換回內建圖。內建圖本身不能刪。
- 「✨ 微調」可以拿內建圖當底圖重畫，ChatGPT 畫日誌插圖時也拿它當人物的參考圖。
- 內建圖不存進瀏覽器的資料庫，也不跟著存檔匯出。
- 世界設定大改了某位固定 NPC 的外貌時，內建圖不會跟著變，請自己生成一張。
- 新增內建圖：在遊戲裡生成、從形象圖匯出（檔名是 NPC id 的 PNG，旁邊可以有同名的 .json），再用 `python3 -I tools/portraits/finalize.py <資料夾或 zip>…` 轉成寬 512 的 webp（只收固定 NPC、跳過標了成人向的）。

操作分兩層：一般玩家用**一般模式**就夠（生成、✨ 微調、翻看舊版、日誌插圖一鍵生成）；想自己控制提示詞、強度、遮罩時才打開**進階**（第 6 節）。

## 1. 設定（⚙️ 設定 → 圖像 → 插圖生成）

API key 與參數只存在這個瀏覽器（localStorage 的 `elondia.image`），請求直接從瀏覽器送往選擇的服務。每個服務各自保存設定，切換服務不會弄丟 key。

| 模板 | 請求 | 預設 | 注意 |
|---|---|---|---|
| ChatGPT（OpenAI 圖片 API） | `POST {網址}/images/generations`，回傳 base64 或網址 | `gpt-image-1`、1024 × 1536 | 看得懂一般句子；不支援負面提示詞；也可以填相容的服務網址 |
| NovelAI | `POST {網址}/ai/generate-image`，回傳 ZIP（裡面是 PNG） | `nai-diffusion-4-5-full`、832 × 1216、28 步、CFG 5、`k_euler_ancestral` | key 是 Persistent API Token；模型可以自己填（欄位會提示 4.5、5 的 full、curated），V4 以後的模型（名稱有 `diffusion-4`、`-5`……）都用 `v4_prompt` 的格式；只看得懂 Danbooru 標籤（預設用「Danbooru 標籤」預處理）；瀏覽器被擋（CORS）時換成自己的轉送代理 |
| ComfyUI（自架） | `POST {網址}/prompt` 送出工作流程 → 輪詢 `/history/{id}` → `GET /view` 下載 | `http://127.0.0.1:8188`、832 × 1216 | 啟動時加 `--enable-cors-header`；模型與參數放在「設定組合」，見下方第 5 節 |

- **參數**：尺寸、步數、CFG、取樣器、負面提示詞（OpenAI 以外）。**額外參數**是一個 JSON 物件，合併進請求（NovelAI 合併進 `parameters`），例如 OpenAI 的 `{"quality": "high"}`。
- **ComfyUI**：每個主模存成一組設定（設定組合），見第 5 節。

### 第一次產生關係時自動畫

插圖設定的「形象插圖」勾「第一次和 NPC 產生關係時自動畫他的形象圖」（`image.ts` 的 `portraitAuto`，預設關）：人際關係裡第一次出現這個人時（認識、雇用、入隊、AI 判定認識了新的人……，`stores/game.ts` 的 `run` 比對動作前後的人際關係），畫一張形象圖。

- 每個人只畫這一次；已經有形象圖（內建的或畫過的）就不畫。回退之後再認識一次也不會重畫。
- 一次認識好幾個人時排隊，一張畫完再畫下一張（`portraits.ts` 的 `autoPortraits`）。
- 生圖服務沒設定好時不畫；開啟之前就認識的人不會補畫（手動按「生成形象圖」）。
- 流程和手動按「生成形象圖」一樣（選了預處理時先改寫描述），每一張都要花錢。

## 2. 提示詞

**形象插圖的提示詞模板**（可以修改、恢復預設）把角色的資料填進去：`{name}` `{gender}` `{race}` `{role}`（職業或身分）`{level}` `{appearance}` `{personality}` `{background}` `{gear}`（身上的裝備；內衣、內褲被上身、下身的衣物蓋住時標「穿在裡面」）`{tattoos}`（刺青與印記：部位、名稱與外觀）`{composition}`（構圖）`{allure}`（慾望的氣質：淫亂、曝露名聲夠高時的一句英文描述，[LEWD_STATS](LEWD_STATS.md) 第 23 節）`{style}`（畫風）。代號的值是空的那一行整行拿掉。預設模板是英文的框架（單人、面向觀眾、簡單背景、不要文字與浮水印），角色的外貌等描述照原文填入。

**構圖**依刺青與裝備的部位自動選（`imageInfo.ts` 的 `portraitComposition`）：大腿、小腿的刺青或腿部飾品 → `full body`；小腹、臀部的刺青或露出來的內褲 → `cowboy shot`；其他 → `upper body`。以前的預設模板把構圖寫死成 upper body，下半身的刺青會在預處理時被丟掉、也畫不出來：沒改過的舊預設模板讀設定時換成新的；自己改過、沒有 `{composition}` 的模板，裡面寫死的 upper body 也會照這個規則換掉。內建的三份預處理指示也要求保留每個刺青、印記與裝備的部位，並照描述的構圖。

「進階」工作台記住的描述（4 節）不會跟著更新：之後換了裝備、多了刺青，要清掉記住的描述（或在工作台裡重新產生）才會寫進去。

## 3. 生圖提示詞預處理

不同的生圖模型吃的提示詞格式不一樣：NovelAI 與動漫風格的 Stable Diffusion 模型只看得懂 Danbooru 標籤，有些模型或自架的工作流程要英文句子或 JSON。「生圖提示詞預處理」在送出前請大語言模型依一份**預處理指示**改寫描述。每個生圖服務各自選用哪一份（`elondia.image` 的 `preprocess`；NovelAI 與 ComfyUI 預設「Danbooru 標籤」，ChatGPT 預設不預處理）：

1. 依模板組成語意描述。
2. 交給大語言模型（設定「模型」頁「功能分配」的「插圖提示詞預處理」用哪個模型來源）：system 是選的指示，user 是角色形象描述。
3. 依指示的**整理方式**處理回答：
   - **整理成標籤**：拿掉程式碼框與「Tags:」之類的說明、換行改逗號、去掉重複。
   - **原樣送出**：只拿掉程式碼框（適合英文句子、JSON）。
4. **結果直接送給生圖服務**，不再套用提示詞模板與畫風。

### 預處理指示

| 內建 | 整理方式 | 內容 |
|---|---|---|
| Danbooru 標籤 | 整理成標籤 | 一行英文標籤，依「人數與性別 → 外貌 → 服裝 → 表情姿勢 → 構圖 → 背景 → 畫質」排列，20～40 個 |
| 英文自然語言描述 | 原樣送出 | 一段 60～120 字的英文描述（主體 → 外貌、服裝 → 表情姿勢 → 構圖、光線、背景），給 DALL·E、Flux、寫實模型 |
| JSON 結構化 | 原樣送出 | 一個 JSON 物件：`subject` `appearance` `outfit` `expression` `pose` `composition` `background` `style` `quality` |

- 內建的指示不能修改；「📋 複製成自訂」複製一份再改。「＋ 新增預處理指示」建立空白的一份。自訂的指示有名稱、整理方式與指示內容，存在 `elondia.image` 的 `preprocessors`。
- 刪除自訂的指示時，用它的服務改成不預處理。
- 舊版的「先轉成 Danbooru 標籤」勾選自動換成「Danbooru 標籤」；改過的轉換指示變成一份自訂的「Danbooru 標籤（自訂）」。

預處理的 token 用量記在日誌的「其他」用量（功能是「插圖提示詞預處理」）。送出的提示詞與預處理前的描述在形象圖的「進階」工作台裡看（第 6 節）。

## 4. 保存

- 圖片存在這個瀏覽器的 IndexedDB（`elondia-portraits`），太大放不進 localStorage，也不放進存檔欄位。
- 匯出時附上形象圖、匯入時還原、沒有存檔用到的圖自動清掉：見 [SAVES.md](SAVES.md) 第 2～4 節。
- 依「這一局（存檔的種子）＋角色 id」保存，不同存檔的主角不會互相蓋掉。同一個資料庫裡的 key：

| key | 內容 | 匯出 |
|---|---|---|
| `種子:角色id` | 目前的形象圖（隊伍、關係裡顯示的那張） | 帶 |
| `種子:角色id~時間` | 生成過的每一版（生成、微調、進階、上傳都算一版） | 不帶 |
| `種子:角色id!desc` | 進階模式「記住」的描述（之後「重新生成」也用） | 不帶 |
| `種子:@scene:日誌id` | 日誌插圖（第 7 節） | 帶 |

- 每個角色保留最近 8 版（`MAX_VERSIONS`）；超過時刪掉最舊的，目前的形象圖那版不會被刪。舊資料只有目前的圖時，第一次讀取各版會把它補成第一版。
- 每一版記下送出的提示詞、預處理前的描述、服務、**種子**（OpenAI 沒有種子）、這次另外指定的負面提示詞、怎麼來的（生成、微調、進階、上傳）。
- 生成中可以取消；出錯時顯示原因（例如還沒設定 key、服務回應 401、CORS 被擋）。

## 5. ComfyUI 的設定組合

程式：`src/narrator/comfy.ts`（組工作流程、匯入、清單、錯誤訊息）、`src/components/ComfySettings.vue`。

每個主模存成一組設定，切換組合就一次換掉模型、文字編碼器、VAE、LoRA、取樣參數、前綴標籤與負面提示詞（例如 Illustrious 的 LoRA 不能用在 Anima 上，取樣器與 CFG 也不一樣）。

### 三種模式

| 模式 | 組出的工作流程（只用 ComfyUI 原生節點） | 要選的東西 |
|---|---|---|
| Checkpoint | `CheckpointLoaderSimple` →（選填 `VAELoader`）→ `LoraLoader` ×N → `CLIPTextEncode` ×2 → `EmptyLatentImage` → `KSampler` →（高解析修復：`LatentUpscaleBy` → `KSampler`）→ `VAEDecode` → `SaveImage` | Checkpoint；VAE 選填（空白用內建的） |
| UNet | `UNETLoader` ＋ 文字編碼器（1 個 `CLIPLoader`、2 個 `DualCLIPLoader`、3 個 `TripleCLIPLoader`）＋ `VAELoader` → 之後同上 | UNet、權重精度、文字編碼器與類型、VAE |
| 自訂工作流程 | 貼上的 API 格式 JSON，代號換成值 | 工作流程；成品圖的節點編號（選填） |

- 文字編碼器的「類型」依模型而定（例如 Anima 是 `stable_diffusion`、Flux 是 `flux`、Qwen-Image 是 `qwen_image`）。程式不寫死任何類型，選項直接讀伺服器的。
- **LoRA**：依序套用，每個可以停用、調權重；預設模型與 CLIP 用同一個權重，按「分開調 CLIP」可以各自設定。
- **高解析修復**：latent 放大（倍率、放大方式）後再採樣一次（步數、CFG、重繪強度）。
- **固定前綴標籤**：品質、畫風、LoRA 觸發詞，接在角色的提示詞前面（`前綴, 角色提示詞`）。
- **自訂工作流程的代號**：`%prompt%`（前綴＋角色提示詞）`%negative%` `%width%` `%height%` `%seed%` `%steps%` `%scale%` `%sampler%` `%scheduler%` `%model%`（Checkpoint 或 UNet 欄位）；以圖生圖另外有 `%image%`（上傳的底圖檔名，填在 LoadImage）、`%mask%`（遮罩檔名，填在 LoadImageMask）、`%denoise%`（重繪強度；一般生圖時是 1）。整個字串就是代號時換成原本的型別（數字就是數字）。沒有 `%image%` 的自訂工作流程不能以圖生圖，沒有 `%mask%` 的不能局部重繪。

舊版只有一份 ComfyUI 工作流程：沒改過預設工作流程的變成 Checkpoint 模式（模型欄位就是 Checkpoint），改過的變成自訂工作流程，行為和原本一樣。

### 讀取 ComfyUI 清單

「🔄 讀取 ComfyUI 清單」呼叫 `GET /object_info/<節點>`（`CheckpointLoaderSimple`、`UNETLoader`、`CLIPLoader`、`DualCLIPLoader`、`VAELoader`、`LoraLoader`、`KSampler`、`LatentUpscaleBy`），讀出 Checkpoint、UNet、權重精度、文字編碼器與類型、VAE、LoRA、取樣器、排程器、放大方式。欄位可以從清單選，也可以直接打字。新舊兩種下拉選項格式（`[[選項]]` 與 `["COMBO", {options}]`）都看得懂。

### 從工作流程匯入

貼上（或選檔案）ComfyUI 選單「Export (API)」匯出的 JSON，新增一組設定：

- 從第一次取樣（latent 來自空白 latent 的 `KSampler`）往回找：經過 LoRA 節點直到主模（Checkpoint 或 UNet 載入節點），正面提示詞的編碼節點往回找文字編碼器，解碼最後一次取樣的 `VAEDecode` 找 VAE。
- 看得懂 LoraManager 的 `Unet Loader (LoraManager)`、`Lora Loader (LoraManager)`（一個節點放好幾個 LoRA，只有名稱沒有副檔名）。有讀過清單時，LoRA 名稱對到伺服器的檔名（含子資料夾）；沒讀過時先補 `.safetensors`。
- 取樣器、排程器、CFG、步數、尺寸；`LatentUpscaleBy` 加第二次 `KSampler` 讀成高解析修復；負面提示詞（可以接在提示詞外掛的節點上）。
- 內建模式重現不了、會影響畫面的節點（例如 `FaceDetailer`、`ModelSamplingAuraFlow`）列出來，建議改用自訂工作流程；原本的工作流程已經放進這組的工作流程欄位。存圖、預覽、提示詞與文字工具的節點不影響畫面，不列。

### 送出前檢查與錯誤訊息

- 每次生成前（以及「🧪 檢查設定」）用 `/object_info` 確認工作流程用到的節點伺服器都有；缺的列出來，請到 ComfyUI-Manager 安裝（不會自動安裝：那需要 Manager、要開放安全等級還要重啟，而且讓網頁遠端安裝程式碼風險太高）。
- Checkpoint 與 UNet 模式也檢查選的檔案、類型、取樣器在不在伺服器的清單裡。自訂工作流程只檢查節點（有些外掛節點接受清單外的值），值的問題交給 ComfyUI 回報。
- `/prompt` 回應 400 的 `node_errors`、執行時的 `execution_error` 都翻成「哪個節點的哪個欄位、伺服器上沒有什麼」。

### 以圖生圖

底圖（與遮罩）先用 `POST /upload/image` 上傳到 ComfyUI 的 input 資料夾。內建模式把 `EmptyLatentImage` 換成 `LoadImage` → `VAEEncode`；局部重繪再加 `LoadImageMask`（紅色通道，白色是要重畫的地方）→ `SetLatentNoiseMask`；`KSampler` 的 denoise 是重繪強度。以圖生圖不做高解析修復。剛上傳的檔名不在伺服器的清單裡，送出前檢查不檢查 LoadImage 的圖片欄位。

### 拿哪一張圖

一個工作流程可能有好幾張圖（第一次採樣的預覽、臉部修復前的預覽……）。依序：指定的節點編號 → 存檔的輸出（`SaveImage` 一類，`type: output`）中最後一個節點 → 最後一個有圖的節點（例如只有預覽的工作流程，拿最後的「完成」預覽）。

## 6. 微調、以圖生圖與進階工作台

### 一般模式（`PortraitBox`）

- 版面：角色設定裡的形象圖是固定寬度的一欄，圖片在上，按鈕與微調在圖片下面，不擠右邊的設定。
- **重新生成**：和以前一樣，新的一張成為目前的形象圖；舊的還在，圖片下面的「‹ 2 / 5 ›」可以翻回去（翻到哪張，哪張就是目前的形象圖）。
- **✨ 微調**：以目前的形象圖為底重畫（以圖生圖），構圖不變。選一個預設，或寫一句想改什麼：

| 預設 | 重繪強度 | 加進提示詞 |
|---|---|---|
| 小幅變化 | 0.35 | （不加） |
| 微笑、害羞、生氣、難過 | 0.5 | 對應的表情標籤（例如 `blush, shy, embarrassed`） |
| 修正崩壞 | 0.3 | `detailed face, detailed hands`，負面提示詞另外加 `bad hands, bad anatomy, deformed, extra fingers` |
| 自己寫一句 | 0.55 | 有預處理時：把「這次要改的」接在描述後面重新預處理；沒有時直接接在上次的提示詞後面 |

  ChatGPT 是照文字指示改圖（`/images/edits`），微調寫成「Edit this image: …. Keep the same character, face, hairstyle, outfit, art style and composition.」。
- 底圖會縮放、裁切成目前服務的出圖尺寸（`fitImage`）。

### 進階工作台（`PortraitStudio`，按「進階」打開）

一般模式不夠用時才打開。左邊是選的那一版與各版縮圖（★ 是目前的形象圖），可以設為形象圖、下載、刪除（目前的形象圖那版不能刪）。**進階生成的圖是新的一版，不會換掉目前的形象圖**，按「★ 設為形象圖」才換。

- **提示詞**分頁：
  1. 預處理前的描述：可以改。「只預處理」看看會改成什麼；「預處理並生圖」照改過的描述重新預處理再生圖。勾「記住為這個角色的描述」時存起來（`!desc`），之後一般模式的「重新生成」也用這段；「依角色資料重組」回到依模板組成的描述。
  2. 送出的提示詞：直接改，按「直接用這段生圖」不再經過預處理。這次的負面提示詞、種子（隨機、沿用這版、指定）。固定種子只改幾個詞，就是同一張圖的微調。ChatGPT 沒有種子與負面提示詞，這兩欄不顯示。
- **以圖生圖**分頁：底圖選某一版或上傳的圖片；整張重繪或局部重繪（在左邊的圖上塗遮罩，紅色是要重畫的地方，可以擦掉、調筆刷）；重繪強度 0.1～0.95；提示詞預設帶入那一版送出的提示詞。

| 服務 | 整張重繪 | 局部重繪 |
|---|---|---|
| ComfyUI | 內建模式自動改成以圖生圖（第 5 節）；自訂工作流程要有 `%image%` | 內建模式加遮罩；自訂工作流程要有 `%mask%` |
| NovelAI | `action: img2img`（`image`、`strength`、`noise`） | `action: infill`，模型改用 `-inpainting` 版本，帶 `mask` |
| ChatGPT | `/images/edits`：照文字指示改，沒有重繪強度（不顯示滑桿） | 遮罩轉成 OpenAI 的格式（要改的地方透明）；只是參考範圍，不是硬邊界 |

## 7. 日誌插圖

冒險日誌每則**底下**的插圖圖示（旁邊是「寫出經過／重新寫出經過」的筆圖示；「⋯」選單只剩複製提示詞與報告 JSON）一鍵完成，圖掛在那則日誌下面（可以放大、重新生成、刪除）。

**自動生成**（「⚙️ 設定 → 圖像 → 日誌插圖」，預設關閉）：關閉／只畫成人場景／每一則（有正文的日誌）。正文**第一次寫完**時自動跑下面的流程（`scenes.ts` 的 `auto`，由 `game.ts` 的 `narrate` 結束時、或判定順便寫出經過時呼叫）：

- 沒有正文的日誌不畫（沒開 AI 細節描述、沒寫出經過的日誌，玩家不在意，畫了白花 token）；重寫經過不會重畫。
- 這則已經有圖、正在畫，或生圖服務、「插圖提示詞預處理」的模型來源沒設定好時，什麼都不做，也不顯示錯誤。
- 成人場景（有 `adult_scene`）卻沒指定「成人場景改用」（ChatGPT 畫不出來）時不自動畫，設定頁會提醒。
- 設定旁的三角形警告圖示（滑鼠移上去才顯示文字）說明每一張圖都要花預處理的 token 與一次生圖費用。

手動或自動生成的流程相同：

1. **整理分鏡**：用「插圖提示詞預處理」的模型來源，把日誌（摘要、行動、玩家描述的做法、已經寫出的正文、地點與時段）和可以登場的人（日誌裡的隊伍與其他人，附外貌、裝備、刺青）交給模型，回傳 JSON：`rating`（general、suggestive、explicit）、`scene`（整體畫面：人數、地點、時段、光線、構圖，不含各角色外貌；登場的怪物寫在這裡，要寫出種族特徵，例如 green skin、wolf ears、tail）、`characters`（最多 4 人：id、位置 left／center／right、這個角色的提示詞）。各欄位照這個服務的預處理指示的寫法寫（例如 Danbooru 標籤）；沒有預處理時寫英文句子。日誌不是成人場景（沒有 `adult_scene`）時一律 general、不畫裸露與血腥。用量記在那則日誌。
2. **選服務**：日誌是成人場景（有 `adult_scene`）時，用「⚙️ 設定 → 圖像 → 日誌插圖」的「成人場景改用」；其他用目前的服務。分鏡判定是 explicit、服務卻是 ChatGPT 時，換成成人場景用的服務再整理一次；沒有指定時告訴玩家要指定 NovelAI 或 ComfyUI。
3. **組成請求**（`composeScene`）：
   - **NovelAI**（V4 以後的模型，含 4.5、5）：`scene` 當整體提示詞，每個角色放進 `v4_prompt.caption.char_captions`，位置寫在 `centers`（左 0.3、中 0.5、右 0.7）。V3 以前的模型不能分開描述每個人：分鏡照 ComfyUI 的寫法整理，角色接在 `scene` 後面。
   - **ChatGPT**：一段英文（整體畫面＋「on the left: …」）；登場角色有形象圖時當參考圖一起送（`/images/edits`，最多 4 張），人物長得比較一致。
   - **ComfyUI**：接成一段提示詞（標籤用逗號）。三人以上外貌容易混在一起；需要時改用自己的區域提示工作流程。
   - **畫風**：設定的「畫風」（和形象圖的 `{style}` 同一個）由程式照原樣接在最後：標籤格式用逗號接、句子格式另起一行「Art style: …」。畫師名、`0.8::tag::` 這類權重寫法不經過 AI，不會被改掉；整理分鏡時也告訴 AI 不要自己寫畫風。畫風清空時不接。
4. 尺寸用橫的：長邊當寬（ComfyUI、NovelAI），ChatGPT 是 1536 × 1024。

插圖和形象圖存在同一個資料庫（`種子:@scene:日誌id`），匯出存檔時勾「形象圖與插圖」一起帶。
