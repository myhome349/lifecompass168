// v3.2.2 新增：記錄一筆「使用者登入」事件。
//
// 前端在使用者透過 Netlify Identity（Google 帳號）成功登入後，會呼叫這支 API
// 一次（每個瀏覽器分頁只呼叫一次，見 index.html 裡的 recordLoginOnce），
// 把「誰、什麼時候登入」寫進 Netlify Blobs，之後可以在 App 裡的「登入紀錄」
// 頁面（管理者專用）查看。
//
// 這支程式不需要你修改任何內容，照著部署說明操作即可。

const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  // v3.2.3 修復：Lambda 相容模式必須先呼叫 connectLambda(event) 才能用 Netlify Blobs，
  // 否則會出現 MissingBlobsEnvironmentError（詳見 data.js 裡的說明）。
  connectLambda(event);

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "不支援的方法" });
  }

  // 只信任 Netlify Identity 驗證過的登入身分，前端無法偽造成別人。
  const user = context.clientContext && context.clientContext.user;
  if (!user || !user.sub) {
    return jsonResponse(401, { error: "尚未登入，無法記錄登入事件。" });
  }

  let store;
  try {
    // 跟一般使用者資料（lifecompass-user-data）分開存放，避免混在一起。
    store = getStore("lifecompass-login-logs");
  } catch (err) {
    return jsonResponse(500, { error: "儲存空間初始化失敗：" + describeError(err) });
  }

  const meta = user.user_metadata || {};
  const appMeta = user.app_metadata || {};
  const record = {
    ts: new Date().toISOString(),
    userId: user.sub,
    email: user.email || "",
    name: meta.full_name || meta.name || "",
    provider: (appMeta.provider) || (Array.isArray(appMeta.providers) ? appMeta.providers.join(",") : "") || "",
    // Netlify 在邊緣節點會把使用者的來源 IP 放進這個標頭，記錄下來方便管理者
    // 察覺異常登入（例如同一帳號短時間內從很不同的地方登入）。
    ip: (event.headers && (event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"])) || "",
  };

  // key 用「時間戳記-亂數」，時間戳記在前面可以讓字串排序直接等於時間排序，
  // 亂數尾巴避免極短時間內兩筆紀錄剛好用同一個 key 互相覆蓋。
  const key = Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  try {
    await store.set(key, JSON.stringify(record));
    return jsonResponse(200, { ok: true });
  } catch (err) {
    return jsonResponse(500, { error: "寫入登入紀錄失敗：" + describeError(err) });
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
