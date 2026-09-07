// v3.2.9 新增：不論使用者「有沒有」用 Google 帳號登入，都會呼叫這支 API 留下
// 一筆足跡紀錄，給管理者在「操作紀錄」頁面查看，方便未來排查問題／異常操作用。
//
// 跟 log-login.js 最大的不同：log-login.js 只在「已經登入」的情況下才會被
// 呼叫、也只記得到已登入的人；這支 track.js 完全不要求登入，未登入的訪客
// 一樣可以呼叫（前端會帶一個存在瀏覽器 localStorage 裡、產生一次就固定不變
// 的匿名代碼 anonId，讓管理者至少能看出「這是不是同一台裝置回訪」）。
// 所以不管使用者有沒有登入 Google 帳號，都留得下：中文姓名／信箱（有登入
// 才有值）、IP、瀏覽器（User-Agent）、以及這次是什麼操作（例如自己瀏覽／
// 下載／刪除自己的資料，或管理者瀏覽／下載／刪除某位使用者的資料）。
//
// 這支 API 刻意設計成「盡量不要讓寫紀錄這件事本身影響到使用者原本在做的事」：
// 任何錯誤都直接吞掉、一律回傳 200，前端呼叫這支 API 永遠不需要處理失敗、
// 也不會因為紀錄寫入失敗就跳出任何訊息或擋住使用者原本的操作（例如刪除、
// 下載）。前端呼叫這支 API 時完全不會顯示任何說明文字給一般使用者看，純粹
// 是背景記錄，供管理者日後查 bug、追異常使用行為用。
//
// 這支程式不需要你修改任何內容，照著部署說明操作即可。

const { getStore, connectLambda } = require("@netlify/blobs");

// 只允許這幾種動作值寫入，避免前端被竄改後塞入奇怪內容洗版紀錄；
// 未來如果要新增動作類型，在這裡加一個字串即可。
const ALLOWED_ACTIONS = [
  "visit",                    // 開啟網站（不論有無登入）
  "view_own_data",            // 使用者瀏覽自己的資料（例如打開總覽儀表板）
  "download_own_data",        // 使用者下載自己的備份檔
  "delete_own_data",          // 使用者清除自己的所有資料
  "admin_view_userdata",      // 管理者瀏覽某位使用者的資料內容
  "admin_download_userdata",  // 管理者下載某位使用者的資料
  "admin_delete_userdata",    // 管理者刪除某位使用者的資料
];

exports.handler = async (event, context) => {
  // Lambda 相容模式必須先呼叫 connectLambda(event) 才能用 Netlify Blobs
  // （原因同 data.js 裡的說明，否則會出現 MissingBlobsEnvironmentError）。
  connectLambda(event);

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "不支援的方法" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(200, { ok: false }); // 格式錯誤也不讓前端出現任何錯誤提示，安靜略過
  }

  const action = ALLOWED_ACTIONS.indexOf(body.action) !== -1 ? body.action : "visit";
  // target／detail 只是輔助說明用的文字，長度做上限保護，避免異常資料塞爆儲存空間。
  const target = typeof body.target === "string" ? body.target.slice(0, 200) : "";
  const detail = typeof body.detail === "string" ? body.detail.slice(0, 500) : "";
  const anonId = typeof body.anonId === "string" ? body.anonId.slice(0, 100) : "";

  // 有沒有登入都可以記錄——這是跟其他 admin 系列 function 最大的不同：
  // 這裡「不」要求、也「不」擋未登入的請求，只是有登入的話能多記到身分資訊。
  const user = (context && context.clientContext && context.clientContext.user) || null;
  const meta = (user && user.user_metadata) || {};
  const appMeta = (user && user.app_metadata) || {};

  const record = {
    ts: new Date().toISOString(),
    action: action,
    target: target,
    detail: detail,
    anonId: anonId,
    userId: (user && user.sub) || "",
    // 中文姓名優先讀 full_name（Google 帳號常見欄位），沒有才退回 name。
    name: meta.full_name || meta.name || "",
    email: (user && user.email) || "",
    provider: appMeta.provider || (Array.isArray(appMeta.providers) ? appMeta.providers.join(",") : "") || "",
    // Netlify 在邊緣節點會把使用者的來源 IP 放進這個標頭。
    ip: (event.headers && (event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"])) || "",
    userAgent: (event.headers && event.headers["user-agent"]) || "",
  };

  try {
    let store;
    try {
      store = getStore("lifecompass-audit-log");
    } catch (err) {
      return jsonResponse(200, { ok: false }); // 儲存空間初始化失敗也不影響前端，安靜回傳
    }
    // key 用「時間戳記-亂數」，時間戳記在前面可以讓字串排序直接等於時間排序。
    const key = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    await store.set(key, JSON.stringify(record));
    return jsonResponse(200, { ok: true });
  } catch (err) {
    return jsonResponse(200, { ok: false });
  }
};

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode: statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  };
}
