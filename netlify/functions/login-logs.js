// v3.2.2 新增：讀取登入紀錄清單（只有管理者能看）。
//
// 這支 API 給 App 裡的「登入紀錄」頁面呼叫。判斷「誰是管理者」的方式：
// 到 Netlify 後台 → Project configuration → Environment variables，新增一個
// 叫做 ADMIN_EMAILS 的變數，值填你自己的信箱（多個管理者用逗號分隔，例如
// "you@gmail.com,partner@gmail.com"）。只有登入信箱出現在這個清單裡的人，
// 呼叫這支 API 才拿得到資料，其他人一律收到「沒有權限」的錯誤訊息。
//
// 這支程式不需要你修改任何內容，只要照部署說明去 Netlify 後台設定
// ADMIN_EMAILS 這個環境變數即可。

const { getStore, connectLambda } = require("@netlify/blobs");

const MAX_RECORDS = 300;

exports.handler = async (event, context) => {
  // v3.2.3 修復：Lambda 相容模式必須先呼叫 connectLambda(event) 才能用 Netlify Blobs，
  // 否則會出現 MissingBlobsEnvironmentError（詳見 data.js 裡的說明）。
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
    return jsonResponse(403, { error: "你的帳號沒有查看登入紀錄的權限。" });
  }

  let store;
  try {
    store = getStore("lifecompass-login-logs");
  } catch (err) {
    return jsonResponse(500, { error: "儲存空間初始化失敗：" + describeError(err) });
  }

  try {
    const listResult = await store.list();
    let keys = (listResult && listResult.blobs) ? listResult.blobs.map(function (b) { return b.key; }) : [];
    // key 的開頭是時間戳記字串，字串排序（由大到小）就等於「由新到舊」的時間排序。
    keys.sort().reverse();
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
    return jsonResponse(200, { records: records });
  } catch (err) {
    return jsonResponse(500, { error: "讀取登入紀錄失敗：" + describeError(err) });
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
