// v3.2.9 新增：讀取「操作紀錄」清單（只有管理者能看）。
//
// 資料來源是 track.js 寫入的 lifecompass-audit-log store——不管使用者有沒有
// 登入 Google 帳號都會被記錄，包含：中文姓名／信箱（有登入才有值）、IP、
// 瀏覽器（User-Agent）、匿名代碼（未登入訪客用來辨識是否為同一裝置回訪）、
// 以及這一筆是什麼操作（開啟網站、瀏覽／下載／刪除自己或被管理者操作的資料）。
// 用途是給管理者未來排查問題（查 bug）、追蹤異常操作用，前端完全不會對一般
// 使用者顯示任何相關說明或提示。
//
// 權限判斷方式跟 login-logs.js／admin-userdata.js 完全一樣：比對登入者 email
// 是否出現在 Netlify 環境變數 ADMIN_EMAILS 裡（逗號分隔），不是管理者一律
// 回傳 403，不會拿到任何紀錄內容。
//
// 這支程式不需要你修改任何內容，只要照部署說明去 Netlify 後台設定
// ADMIN_EMAILS 這個環境變數即可（跟「登入紀錄」「使用者資料」共用同一個
// 環境變數，不需要另外新增設定）。

const { getStore, connectLambda } = require("@netlify/blobs");

const MAX_RECORDS = 500;

exports.handler = async (event, context) => {
  connectLambda(event);

  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "不支援的方法" });
  }

  const user = context.clientContext && context.clientContext.user;
  if (!user || !user.sub) {
    return jsonResponse(401, { error: "尚未登入。" });
  }

  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);

  if (adminEmails.length === 0) {
    return jsonResponse(403, {
      error: "尚未設定管理者名單。請到 Netlify 後台 Project configuration → Environment variables，" +
        "新增 ADMIN_EMAILS（值填你的登入信箱），存檔後重新部署一次網站即可。",
    });
  }

  const myEmail = (user.email || "").toLowerCase();
  if (adminEmails.indexOf(myEmail) === -1) {
    return jsonResponse(403, { error: "你的帳號沒有查看操作紀錄的權限。" });
  }

  let store;
  try {
    store = getStore("lifecompass-audit-log");
  } catch (err) {
    return jsonResponse(500, { error: "儲存空間初始化失敗：" + describeError(err) });
  }

  try {
    const listResult = await store.list();
    let keys = (listResult && listResult.blobs) ? listResult.blobs.map(function (b) { return b.key; }) : [];
    // key 的開頭是時間戳記字串，字串排序（由大到小）就等於「由新到舊」的時間排序。
    keys.sort().reverse();
    const totalCount = keys.length;
    keys = keys.slice(0, MAX_RECORDS);

    const records = [];
    for (const key of keys) {
      try {
        const raw = await store.get(key);
        if (raw) records.push(JSON.parse(raw));
      } catch (e) {
        // 單筆讀取或解析失敗就跳過，不要因為一筆壞資料讓整份清單都讀不出來。
      }
    }
    return jsonResponse(200, { records: records, totalCount: totalCount });
  } catch (err) {
    return jsonResponse(500, { error: "讀取操作紀錄失敗：" + describeError(err) });
  }
};

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode: statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  };
}

function describeError(err) {
  return err && err.message ? err.message : String(err);
}
