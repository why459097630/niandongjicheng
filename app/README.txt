NDJC build closure starter (8 files)

Included files:
- app/api/start-build/route.ts
- app/api/build-status/route.ts
- app/api/build-list/route.ts
- lib/build/types.ts
- lib/build/storage.ts
- lib/build/startBuild.ts
- lib/build/getBuildStatus.ts
- lib/build/getBuildList.ts

Notes:
1. This is a dev/demo mock closure layer based on the current UI pages.
2. It uses in-memory storage via globalThis, so it is suitable for local development first.
3. In production/serverless, replace storage.ts with database or persistent store.
4. Your existing UI pages still need wiring changes to call these APIs.

NDJC app directory placeholder.

内容真实统计对接说明：

1. 全站页面访问统计
- 已通过 components/analytics/PageViewTracker.tsx + /api/track-page-view 接入。
- 只要 app/layout.tsx 渲染了 <PageViewTracker />，页面访问会自动写入 page_view_logs。

2. 商品 / 公告真实点击与浏览统计
- 统一走 POST /api/track-content-engagement
- 支持的 action：
  - dish_view
  - dish_click
  - announcement_view

请求示例：
fetch("/api/track-content-engagement", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    storeId: "store_xxx",
    action: "dish_view",
    dishId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  })
});

fetch("/api/track-content-engagement", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    storeId: "store_xxx",
    action: "dish_click",
    dishId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  })
});

fetch("/api/track-content-engagement", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    storeId: "store_xxx",
    action: "announcement_view",
    announcementId: "announcement_id_text"
  })
});

3. 环境变量
前端仓库需要存在以下变量之一：
- NEXT_PUBLIC_APP_CLOUD_SUPABASE_ANON_KEY
- APP_CLOUD_SUPABASE_ANON_KEY

以及：
- APP_CLOUD_SUPABASE_URL