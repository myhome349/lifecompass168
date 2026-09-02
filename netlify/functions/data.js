// v3.2.1 新增：LifeCompass 的後端資料儲存 API。
//
// 這支程式部署到 Netlify 後會變成一個網址：/.netlify/functions/data
// 前端（index.html 裡的 serverStorageGet / serverStorageSet）就是呼叫這個網址
// 來讀寫使用者的測驗與打卡資料。
//
// 資料實際存放在 Netlify Blobs——這是 Netlify 內建的儲存空間，只要網站部署在
// Netlify 上，這支程式就能直接使用，不需要另外申請帳號或設定金鑰。
//
// 安全機制：
// 這支程式只信任 Netlify Identity 幫忙驗證過的登入身分（context.clientContext.user），
// 前端每次呼叫都要帶著使用者登入後拿到的權杖（JWT）；沒有帶正確權杖、或還沒登入，
// 一律回傳 401（未授權），不會讀到或寫到任何資料。
// 資料用「使用者帳號 ID + 資料項目名稱」當作儲存空間裡的鍵值，
// 所以不同使用者的資料完全分開，彼此看不到對方的內容。
//
// 你不需要修改這支檔案的任何內容，照著說明部署即可正常運作。

const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  // v3.2.3 修復：這支程式用的是「Lambda 相容模式」的寫法（exports.handler），
  // Netlify Blobs 在這種模式下不會自動注入連線資訊，一定要在呼叫 getStore()
  // 之前手動呼叫 connectLambda(event)，否則會出現
  // 「MissingBlobsEnvironmentError: The environment has not been configured...」
  // 這個錯誤。這是 Netlify Blobs 官方文件裡明確要求的寫法，不是你操作錯誤。
  connectLambda(event);

  // 只允許 GET（讀取）與 POST（寫入）
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "不支援的方法" });
  }

  // 確認使用者已透過 Netlify Identity 登入。
  // Netlify 會自動解析前端送來的 Authorization: Bearer <token>，
  // 驗證成功的話會把使用者資訊放進 context.clientContext.user。
  const user = context.clientContext && context.clientContext.user;
  if (!user || !user.sub) {
    return jsonResponse(401, { error: "尚未登入或登入已過期，請重新整理頁面再試一次。" });
  }
  const userId = user.sub;

  let store;
  try {
    // 所有使用者共用同一個「儲存空間」（lifecompass-user-data），
    // 但每筆資料的鍵值都會加上使用者 ID 當前綴，資料彼此不會互相看到。
    store = getStore("lifecompass-user-data");
  } catch (err) {
    return jsonResponse(500, { error: "儲存空間初始化失敗：" + describeError(err) });
  }

  try {
    if (event.httpMethod === "GET") {
      const key = event.queryStringParameters && event.queryStringParameters.key;
      if (!key) return jsonResponse(400, { error: "缺少 key 參數" });

      const raw = await store.get(blobKey(userId, key));
      const value = raw ? JSON.parse(raw) : null;
      return jsonResponse(200, { value: value });
    }

    // POST：寫入資料
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return jsonResponse(400, { error: "請求格式錯誤，body 必須是合法的 JSON" });
    }
    const key = body.key;
    if (!key) return jsonResponse(400, { error: "缺少 key 參數" });

    const value = body.value === undefined ? null : body.value;
    await store.set(blobKey(userId, key), JSON.stringify(value));
    return jsonResponse(200, { ok: true });
  } catch (err) {
    return jsonResponse(500, { error: "伺服器錯誤：" + describeError(err) });
  }
};

function blobKey(userId, key) {
  return userId + "/" + key;
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
