# 人生羅盤 LifeCompass v3.2.5 —— Netlify 部署說明

這份資料夾裡的檔案已經把「雲端資料儲存」＋「登入紀錄」的後端程式都寫好了，
你不需要寫任何程式碼，只要照著下面的步驟，用滑鼠點一點、上傳檔案就能完成。

> **v3.2.5 更新說明**：新增「👥 使用者資料」管理頁面（在側邊選單「登入紀錄」
> 下方），讓管理者可以看到**所有使用者**已經存到雲端的測驗結果、打卡紀錄、
> 整合報告等資料，不只是登入紀錄而已。權限判斷方式跟「登入紀錄」完全一樣，
> 都是看登入信箱有沒有出現在 `ADMIN_EMAILS` 這個環境變數裡——**如果你已經
> 設定過 `ADMIN_EMAILS`，這個新功能不需要再多做任何設定，upload 覆蓋檔案、
> 重新部署後就會直接生效**；如果還沒設定過，請照下面「階段四」的步驟設定。
> 新增的檔案是 `netlify/functions/admin-userdata.js`，上傳時記得跟其他
> `.js` 檔案一樣放在 `netlify/functions/` 資料夾裡。
>
> **v3.2.4 更新說明**：修正「登入紀錄」偶爾記不到資料的問題——如果你在
> v3.2.3 修好 `MissingBlobsEnvironmentError` 之前，用同一個瀏覽器分頁登入
> 測試過，那次失敗會讓瀏覽器誤以為「已經記錄過」，之後同一分頁重新整理、
> 重新登入都不會再補記。升級後這個情況已修正，之後任何一次記錄失敗都會在
> 下次登入時自動重試，不會被卡住。**如果你先前測試過、清單裡還是空的**，
> 開一個全新的瀏覽器分頁重新登入一次即可（因為卡住的狀態是記在那個舊分頁裡）。
>
> **v3.2.3 更新說明**：修正了「登入紀錄」頁面出現
> `MissingBlobsEnvironmentError` 錯誤訊息的問題（後端程式少了一行初始化
> 設定）。

整個流程分成四大階段：
1. 把檔案放到 GitHub（當作 Netlify 抓取檔案的中轉站）
2. 讓 Netlify 連到這個 GitHub 專案，自動部署成網站
3. 在 Netlify 後台開啟登入功能（Identity）
4. 設定「誰是管理者」，開啟登入紀錄查看功能

預估時間：第一次設定大約 20 分鐘，之後每次更新只要 1 分鐘（上傳新檔案，
Netlify 會自動重新部署）。

---

## 準備工作：資料夾裡有什麼

```
deploy-package/
├── index.html                      ← 主要網頁（你的整個 App）
├── netlify.toml                    ← 告訴 Netlify 檔案放在哪裡（不用修改）
├── package.json                    ← 告訴 Netlify 需要安裝哪個套件（不用修改）
└── netlify/
    └── functions/
        ├── data.js                 ← 後端程式：負責把測驗資料存進 Netlify Blobs（不用修改）
        ├── log-login.js            ← 後端程式：使用者登入時記一筆紀錄（不用修改）
        ├── login-logs.js           ← 後端程式：給管理者查看登入紀錄清單（不用修改）
        └── admin-userdata.js       ← 後端程式：給管理者查看「所有使用者」的測驗／打卡資料（不用修改）
```

**上傳的時候，這個資料夾結構（尤其是 `netlify/functions/` 這一層層的
路徑）一定要保持原樣**，不能把裡面的 `.js` 檔案單獨抽出來放在別的地方，
不然後端功能會抓不到。

---

## 階段一：把檔案放到 GitHub

如果你已經有 GitHub 帳號、也已經有這個專案的 repository，可以直接跳到
「更新既有專案」那一段。

### 第一次建立

1. 到 [github.com](https://github.com) 註冊一個免費帳號（如果還沒有的話）。
2. 登入後，右上角點「+」→「New repository」。
3. Repository name 隨便取一個英文名字，例如 `lifecompass`。
4. 其他選項用預設值就好（Public 或 Private 都可以），按「Create repository」。
5. 建立完成後，畫面上會有一個「uploading an existing file」的連結，點下去。
   （或是在 repository 頁面點「Add file」→「Upload files」）
6. 把 `deploy-package` 資料夾**裡面**的所有檔案和資料夾，整包拖曳到網頁的
   上傳區塊（GitHub 網頁版支援連同資料夾一起拖曳上傳，會自動保留資料夾結構）。
7. 拉到頁面下方，按綠色的「Commit changes」按鈕完成上傳。

### 更新既有專案

之後如果我再幫你改程式、給你新的一批檔案，你只要：
1. 到你的 GitHub repository 頁面
2. 用「Add file」→「Upload files」，把新的檔案拖上去，同名檔案會自動覆蓋舊的
3. 按「Commit changes」

Netlify 偵測到 GitHub 有更新，會自動重新部署，不用再做其他事。

---

## 階段二：讓 Netlify 部署這個網站

1. 到 [netlify.com](https://www.netlify.com) 註冊一個免費帳號——**建議直接選
   「Sign up with GitHub」**，用剛剛的 GitHub 帳號登入，這樣後面連動專案會
   更方便。
2. 登入後，在 Netlify 後台找「Add new site」→「Import an existing project」。
3. 選擇「Deploy with GitHub」，如果是第一次會請你授權 Netlify 存取 GitHub，
   照畫面指示按「Authorize」即可。
4. 從清單裡選到剛剛建立的 repository（例如 `lifecompass`）。
5. 部署設定畫面會自動抓到 `netlify.toml` 裡的設定，通常不需要改任何欄位，
   直接按「Deploy site」。
6. 等待約 1–2 分鐘，畫面會顯示「Site is live」，並給你一個網址，
   類似 `https://隨機取的名字.netlify.app`，這就是你的正式網站了。

（如果之後想換成自己買的網域名稱，例如 `lifecompass.com`，可以在
「Domain settings」裡設定，這是後話，先不急。）

---

## 階段三：開啟登入功能（Netlify Identity）

網頁裡已經內建「請先用 Google 帳號登入」的畫面，但需要在後台手動開啟這個
功能才會真正生效：

1. 在 Netlify 後台，進到剛剛部署好的網站，點左側選單的「Identity」。
2. 點「Enable Identity」。
3. 進到 Identity 設定頁後，找「Registration」，可以先設成「Invite only」
   （只有你邀請的人才能註冊），或維持「Open」讓任何人都能自行註冊，
   看你想不想開放給其他人使用。
4. 找「External providers」（外部登入提供者），點「Add provider」→
   選「Google」，照畫面指示完成設定（這一步 Netlify 會提供預設的 Google
   登入設定，通常不需要你自己去 Google 申請金鑰，用 Netlify 內建的即可）。
5. 儲存設定後，回到你的網站網址，重新整理頁面，應該就會看到「請先使用
   Google 帳號登入」的畫面，點下去登入後就能開始使用，資料也會自動存到
   雲端了。

---

## 階段四：設定管理者，開啟「登入紀錄」查看功能

App 左側選單有一個「🔐 登入紀錄」，會列出每一次有人用 Google 帳號登入這個
網站的時間、名稱、信箱。這一頁**任何登入的人都看得到選單項目、都能點進去**，
但只有你設定的管理者信箱才看得到實際內容，其他人點進去只會看到「沒有權限」。

1. 在 Netlify 後台，進到你的網站 → 左側選單「Project configuration」→
   「Environment variables」。
2. 點「Add a variable」，Key 填 `ADMIN_EMAILS`，Value 填你自己登入用的
   Google 信箱（如果有多個管理者，用逗號分隔，例如
   `you@gmail.com,partner@gmail.com`，不要有空格）。
3. 存檔後，回到「Deploys」頁籤，點「Trigger deploy」→「Deploy site」，
   手動重新部署一次（環境變數要重新部署後才會生效）。
4. 部署完成後，用你剛剛填的那個信箱登入網站，點左側選單「🔐 登入紀錄」，
   應該就能看到登入清單了（如果你自己是第一次登入，清單裡至少會有你這一筆）。

之後如果想拿掉某個管理者，或新增管理者，回到同一個地方修改
`ADMIN_EMAILS` 的值，存檔後一樣要「Trigger deploy」重新部署一次才會生效。

**沒有設定 `ADMIN_EMAILS` 之前**，任何人點「登入紀錄」都會看到提醒訊息，
告訴你需要先去 Netlify 後台設定，不會出錯或當機，也不會外洩任何資料。

---

## 怎麼確認「真的存到雲端」了

1. 用手機瀏覽器或另一台電腦，打開同一個網址
2. 用同一個 Google 帳號登入
3. 應該會看到跟原本裝置上一樣的測驗紀錄——這樣就代表雲端儲存確實生效了。

如果換裝置後資料是空的，最常見的原因是：
- 忘記做「階段三」開啟 Identity，或忘記加 Google 登入提供者
- 兩台裝置登入的不是同一個 Google 帳號

---

## 之後想繼續請我改功能，怎麼交件

你只要把我之後給你的新檔案（通常是 `index.html`，有時候會多幾支像
`data.js`、`log-login.js`、`login-logs.js` 這樣放在 `netlify/functions/`
資料夾裡的後端程式）拿去 GitHub 上傳覆蓋，Netlify 就會自動重新部署，不需要
重新走一次階段二、三、四的設定（那些是一次性的，除非我特別告訴你需要新增
環境變數）。

---

## 常見問題

**Q: 「登入紀錄」會不會被一般使用者看到？**
不會。頁面內容是後端 API（`login-logs.js`）依照 `ADMIN_EMAILS` 這個環境變數
判斷權限，不是管理者的帳號呼叫這支 API 一律會被拒絕，不會拿到任何資料，
就算對方懂技術、打開瀏覽器開發者工具直接呼叫 API 也一樣拒絕。

**Q: 「使用者資料」頁面看得到多詳細？一般使用者知道自己的資料被管理者看到嗎？**
管理者能看到的是每位使用者存到雲端的原始資料（測驗結果、打卡紀錄、整合報告
內容等），跟該使用者自己在 App 裡看到的內容是一樣的，只是換管理者的角度
瀏覽全部人的。目前程式本身沒有另外顯示「你的資料管理者看得到」這類提示給
一般使用者，如果這個網站會開放給你（開發者）以外的人使用，建議你自行在
網站上加一段告知或使用條款，說明資料存放與管理者查看的範圍，這是使用者
隱私與法遵層面的考量，不是程式技術問題。

**Q: Netlify Blobs 需要另外付費或申請帳號嗎？**
不用。只要網站是部署在 Netlify 上，Blobs 儲存空間是內建的，免費方案就可以用，
不需要另外去別的網站註冊或設定金鑰。

**Q: 如果我想先在自己電腦上測試，不想馬上開放給別人用怎麼辦？**
Identity 的 Registration 設成「Invite only」，然後在 Identity 頁面手動邀請
自己的信箱，就只有你能登入使用。

**Q: 我如果之後想連自己的網域名稱（例如 lifecompass.tw）呢？**
到 Netlify 後台「Domain settings」加上你的網域，並依照畫面指示到你買網域
的地方（GoDaddy、Namecheap 等）設定 DNS，這部分需要的話我可以再另外寫一份
更詳細的說明。
