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
//
// v3.2.9 新增：
//   ① GET 加上 ?download=1&userId=xxx 這兩個查詢參數時，改成只回傳「單一
//      使用者」的完整資料，並附上 Content-Disposition 標頭讓瀏覽器直接
//      當成檔案下載，不用再靠前端自己組 Blob（前端目前仍是用這種方式做
//      下載，這支後端的下載模式是保留給未來或其他呼叫端使用的等價能力）。
//   ② 新增 DELETE 方法：?userId=xxx 刪除該使用者「全部」資料，或加上
//      ?item=xxx 只刪除該使用者的單一資料項目。刪除前一樣要通過上面的
//      管理者權限檢查。
//   ③ 不論是「瀏覽清單」「下載」「刪除」，這支程式都會在成功之後於伺服器端
//      補寫一筆稽核紀錄到 lifecompass-audit-log（與 track.js 共用同一個
//      store），紀錄管理者是誰、對哪個使用者做了什麼操作、什麼時間——
//      就算前端程式碼被繞過或呼叫端沒有另外呼叫 track.js，後端這裡還是會
//      留下紀錄，確保「使用者資料的瀏覽／下載／刪除」一定查得到軌跡。

const { getStore, connectLambda } = require("@netlify/blobs");

const MAX_USERS = 500; // 保險上限，避免使用者數量異常暴增時單次回應過大/過慢

exports.handler = async (event, context) => {
  // Lambda 相容模式必須先呼叫 connectLambda(event) 才能用 Netlify Blobs
  // （原因同 data.js／login-logs.js 裡的說明，否則會出現 MissingBlobsEnvironmentError）。
  connectLambda(event);

  if (event.httpMethod !== "GET" && event.httpMethod !== "DELETE") {
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

  const qs = event.queryStringParameters || {};

  // ---- DELETE：管理者刪除某位使用者的全部（或單一項目）資料 ----
  if (event.httpMethod === "DELETE") {
    const targetUserId = qs.userId;
    if (!targetUserId) return jsonResponse(400, { error: "缺少 userId 參數" });

    try {
      const listResult = await dataStore.list({ prefix: targetUserId + "/" });
      const keysToDelete = (listResult && listResult.blobs) ? listResult.blobs.map(function (b) { return b.key; }) : [];

      if (qs.item) {
        const singleKey = targetUserId + "/" + qs.item;
        if (keysToDelete.indexOf(singleKey) === -1) {
          return jsonResponse(404, { error: "找不到這筆資料項目。" });
        }
        await dataStore.delete(singleKey);
        await writeAuditRecord(myEmail, user, event, "admin_delete_userdata", targetUserId, "刪除單一項目：" + qs.item);
        return jsonResponse(200, { ok: true, deletedCount: 1 });
      }

      for (const key of keysToDelete) {
        await dataStore.delete(key);
      }
      await writeAuditRecord(myEmail, user, event, "admin_delete_userdata", targetUserId, "刪除該使用者全部資料，共 " + keysToDelete.length + " 筆");
      return jsonResponse(200, { ok: true, deletedCount: keysToDelete.length });
    } catch (err) {
      return jsonResponse(500, { error: "刪除使用者資料失敗：" + describeError(err) });
    }
  }

  // ---- GET + download：管理者下載單一使用者的完整資料 ----
  if (qs.download && qs.userId) {
    const targetUserId = qs.userId;
    try {
      const listResult = await dataStore.list({ prefix: targetUserId + "/" });
      const keys = (listResult && listResult.blobs) ? listResult.blobs.map(function (b) { return b.key; }) : [];
      const dataObj = {};
      for (const fullKey of keys) {
        const itemName = fullKey.slice(targetUserId.length + 1);
        try {
          const raw = await dataStore.get(fullKey);
          dataObj[itemName] = raw ? JSON.parse(raw) : null;
        } catch (e) {
          dataObj[itemName] = null;
        }
      }
      await writeAuditRecord(myEmail, user, event, "admin_download_userdata", targetUserId, "管理者下載使用者資料");
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=\"lifecompass-user-" + encodeURIComponent(targetUserId) + ".json\"",
        },
        body: JSON.stringify({ userId: targetUserId, exportedAt: new Date().toISOString(), data: dataObj }, null, 2),
      };
    } catch (err) {
      return jsonResponse(500, { error: "下載使用者資料失敗：" + describeError(err) });
    }
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

    // v3.2.9 新增：管理者打開「使用者資料」清單這件事本身也留一筆稽核紀錄
    // （不帶特定 target，代表「瀏覽了整份清單」，不是針對單一使用者）。
    await writeAuditRecord(myEmail, user, event, "admin_view_userdata", "", "管理者開啟使用者資料清單，共 " + Object.keys(grouped).length + " 位使用者");

    return jsonResponse(200, { users: users, totalUserCount: Object.keys(grouped).length });
  } catch (err) {
    return jsonResponse(500, { error: "讀取使用者資料失敗：" + describeError(err) });
  }
};

// v3.2.9 新增：把「管理者做了什麼操作」寫進 lifecompass-audit-log
// （跟 track.js 寫入同一個 store，讓「操作紀錄」頁面能統一顯示）。
// 這裡的失敗一律吞掉，絕不能因為稽核紀錄寫不進去，就連帶讓管理者原本要做的
// 瀏覽／下載／刪除操作也失敗。
async function writeAuditRecord(myEmail, user, event, action, target, detail) {
  try {
    const { getStore: getStoreInner } = require("@netlify/blobs");
    const auditStore = getStoreInner("lifecompass-audit-log");
    const meta = (user && user.user_metadata) || {};
    const record = {
      ts: new Date().toISOString(),
      action: action,
      target: target || "",
      detail: detail || "",
      anonId: "",
      userId: (user && user.sub) || "",
      name: meta.full_name || meta.name || "",
      email: myEmail || (user && user.email) || "",
      provider: "admin-panel",
      ip: (event.headers && (event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"])) || "",
      userAgent: (event.headers && event.headers["user-agent"]) || "",
    };
    const key = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    await auditStore.set(key, JSON.stringify(record));
  } catch (err) {
    // 安靜失敗，不影響主要操作。
  }
}

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
