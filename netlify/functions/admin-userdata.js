// v3.2.5 新增：讓管理者查看「所有使用者」的測驗／打卡／整合報告等資料
// （不只是登入紀錄），給 App 裡新增的「👥 使用者資料」管理頁面呼叫。
//
// 資料來源：
//   ① lifecompass-user-data —— data.js 平常在用的 store，每筆資料的 key
//      格式是 "userId/資料項目名稱"（例如 "abc123/lifecompass:integration"）。
//      這支程式把整個 store list 出來，依「/」前面的 userId 分組，
//      就能還原出「每個使用者存了哪些資料、內容是什麼」。
//   ② lifecompass-login-logs —— log-login.js 平常在用的 store，用來反查
//      每個 userId 對應的 email／姓名／最近登入時間，單純是為了讓管理畫面
//      看得懂「這是誰」，不影響權限判斷。
//
// 權限判斷方式跟 login-logs.js 完全一樣：比對登入者 email 是否出現在
// Netlify 環境變數 ADMIN_EMAILS 裡（逗號分隔），不是管理者一律回傳 403，
// 不會拿到任何其他使用者的資料。

const { getStore, connectLambda } = require("@netlify/blobs");

const MAX_USERS = 500; // 保險上限，避免使用者數量異常暴增時單次回應過大/過慢

exports.handler = async (event, context) => {
  // Lambda 相容模式必須先呼叫 connectLambda(event) 才能用 Netlify Blobs
  // （原因同 data.js／login-logs.js 裡的說明，否則會出現 MissingBlobsEnvironmentError）。
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
    return jsonResponse(403, { error: "你的帳號沒有查看使用者資料的權限。" });
  }

  let dataStore, logStore;
  try {
    dataStore = getStore("lifecompass-user-data");
    logStore = getStore("lifecompass-login-logs");
  } catch (err) {
    return jsonResponse(500, { error: "儲存空間初始化失敗：" + describeError(err) });
  }

  // 第一步：把登入紀錄整理成 userId -> { email, name, lastLoginTs } 的對照表，
  // 同一個 userId 可能登入很多次，只保留時間最新的一筆。
  const identityMap = {};
  try {
    const logList = await logStore.list();
    const logKeys = (logList && logList.blobs) ? logList.blobs.map(function (b) { return b.key; }) : [];
    for (const key of logKeys) {
      try {
        const raw = await logStore.get(key);
        if (!raw) continue;
        const rec = JSON.parse(raw);
        if (!rec || !rec.userId) continue;
        const prev = identityMap[rec.userId];
        if (!prev || (rec.ts && rec.ts > prev.lastLoginTs)) {
          identityMap[rec.userId] = {
            email: rec.email || "",
            name: rec.name || "",
            lastLoginTs: rec.ts || "",
          };
        }
      } catch (e) {
        // 單筆壞資料跳過，不影響其他人
      }
    }
  } catch (err) {
    // 登入紀錄讀取失敗不影響主要功能（使用者資料），忽略即可，
    // 畫面上該使用者就只會顯示 userId、看不到 email／姓名。
  }

  // 第二步：把使用者資料 store 依 userId 分組。
  try {
    const listResult = await dataStore.list();
    const allKeys = (listResult && listResult.blobs) ? listResult.blobs.map(function (b) { return b.key; }) : [];

    const grouped = {}; // userId -> [ 完整 key, ... ]
    for (const fullKey of allKeys) {
      const slashIdx = fullKey.indexOf("/");
      if (slashIdx === -1) continue; // 理論上不會發生，保險略過
      const userId = fullKey.slice(0, slashIdx);
      (grouped[userId] = grouped[userId] || []).push(fullKey);
    }

    let userIds = Object.keys(grouped);
    // 讓最近登入過的使用者排前面，方便管理者優先查看。
    userIds.sort(function (a, b) {
      const ta = (identityMap[a] && identityMap[a].lastLoginTs) || "";
      const tb = (identityMap[b] && identityMap[b].lastLoginTs) || "";
      return tb.localeCompare(ta);
    });
    userIds = userIds.slice(0, MAX_USERS);

    const users = [];
    for (const userId of userIds) {
      const dataObj = {};
      for (const fullKey of grouped[userId]) {
        const itemName = fullKey.slice(userId.length + 1);
        try {
          const raw = await dataStore.get(fullKey);
          dataObj[itemName] = raw ? JSON.parse(raw) : null;
        } catch (e) {
          dataObj[itemName] = null;
        }
      }
      const idInfo = identityMap[userId] || {};
      users.push({
        userId: userId,
        email: idInfo.email || "",
        name: idInfo.name || "",
        lastLoginTs: idInfo.lastLoginTs || "",
        data: dataObj,
      });
    }

    return jsonResponse(200, { users: users, totalUserCount: Object.keys(grouped).length });
  } catch (err) {
    return jsonResponse(500, { error: "讀取使用者資料失敗：" + describeError(err) });
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
