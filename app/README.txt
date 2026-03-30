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
