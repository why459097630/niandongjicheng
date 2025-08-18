import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Expected POST body schema:
 * {
 *   packageName: "com.example.meditationtimer",
 *   java: { "MainActivity.java": "...." }  // or just a string of MainActivity.java
 *   resLayout: { "activity_main.xml": "...." } // or string
 *   resValues: { "strings.xml": "...." } // or string
 * }
 *
 * ENV needed:
 *   GH_TOKEN   : GitHub token with repo contents write permission (e.g. classic repo scope or fine-grained)
 *   GH_OWNER   : repo owner, e.g. "why459097630"
 *   GH_REPO    : repo name, e.g. "Packaging-warehouse"
 *   GH_BRANCH  : target branch, default "main"
 */

type Payload = {
  packageName: string;
  java?: string | Record<string, string>;
  resLayout?: string | Record<string, string>;
  resValues?: string | Record<string, string>;
};

const GH_TOKEN = process.env.GH_TOKEN!;
const GH_OWNER = process.env.GH_OWNER!;
const GH_REPO = process.env.GH_REPO!;
const GH_BRANCH = process.env.GH_BRANCH || "main";

const GH_API = "https://api.github.com";

async function githubJson(path: string, init?: RequestInit) {
  const res = await fetch(`${GH_API}${path}`, {
    ...(init || {}),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });

  // 404 is legit for GET /contents (means file doesn't exist) — let caller handle
  if (res.status === 404) {
    return { ok: false, status: 404, json: null as any };
  }

  const json = await res.json();
  if (!res.ok) {
    const msg = typeof json === "object" ? JSON.stringify(json) : String(json);
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${msg}`);
  }
  return { ok: true, status: res.status, json };
}

async function getFileSha(path: string) {
  const r = await githubJson(
    `/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(
      GH_BRANCH
    )}`,
    { method: "GET" }
  );
  if (!r.ok) return undefined;
  return r.json?.sha as string | undefined;
}

function b64(content: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(content, "utf8").toString("base64");
  }
  // Edge runtime fallback
  return (globalThis as any).btoa(unescape(encodeURIComponent(content)));
}

async function putFile(path: string, content: string, message: string) {
  const sha = await getFileSha(path);
  const body = {
    message,
    content: b64(content),
    branch: GH_BRANCH,
    ...(sha ? { sha } : {}),
  };
  const r = await githubJson(
    `/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    }
  );
  return r.json;
}

function normalizeMap(maybe: string | Record<string, string> | undefined, keyName: string) {
  if (!maybe) return {};
  if (typeof maybe === "string") {
    return { [keyName]: maybe };
  }
  return maybe;
}

function pkgToJavaDir(pkg: string) {
  // com.example.meditationtimer -> com/example/meditationtimer
  return pkg.replace(/\./g, "/");
}

function defaultManifest(packageName: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${packageName}">
    <application
        android:allowBackup="true"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.Light.NoActionBar">
        <activity android:name=".MainActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`.trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
      return res.status(500).json({ ok: false, error: "Server missing GH_* envs" });
    }

    const body = (req.body || {}) as Payload;
    const { packageName } = body;

    if (!packageName || !/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)+$/.test(packageName)) {
      return res.status(400).json({ ok: false, error: "Invalid or missing packageName" });
    }

    const javaMap = normalizeMap(body.java, "MainActivity.java");
    const layoutMap = normalizeMap(body.resLayout, "activity_main.xml");
    const valuesMap = normalizeMap(body.resValues, "strings.xml");

    const now = new Date().toISOString();
    const commitPrefix = `chore(gen): apply API payload @ ${now}`;

    // 1) Java 文件
    const javaDirRel = `app/src/main/java/${pkgToJavaDir(packageName)}`;
    // 只处理 MainActivity.java（可按需扩展）
    const mainActivity = javaMap["MainActivity.java"];
    if (!mainActivity || !mainActivity.trim()) {
      return res.status(400).json({ ok: false, error: "java.MainActivity.java is empty" });
    }
    await putFile(
      `${javaDirRel}/MainActivity.java`,
      mainActivity,
      `${commitPrefix} (MainActivity.java)`
    );

    // 2) 布局
    const layoutXml = layoutMap["activity_main.xml"];
    if (!layoutXml || !layoutXml.trim()) {
      return res.status(400).json({ ok: false, error: "resLayout.activity_main.xml is empty" });
    }
    await putFile(
      `app/src/main/res/layout/activity_main.xml`,
      layoutXml,
      `${commitPrefix} (activity_main.xml)`
    );

    // 3) values/strings.xml
    const stringsXml = valuesMap["strings.xml"];
    if (!stringsXml || !stringsXml.trim()) {
      return res.status(400).json({ ok: false, error: "resValues.strings.xml is empty" });
    }
    await putFile(
      `app/src/main/res/values/strings.xml`,
      stringsXml,
      `${commitPrefix} (strings.xml)`
    );

    // 4) AndroidManifest.xml 兜底：如果不存在就写一个默认的，确保包名正确且可启动
    const manifestPath = `app/src/main/AndroidManifest.xml`;
    const manifestSha = await getFileSha(manifestPath);
    if (!manifestSha) {
      await putFile(manifestPath, defaultManifest(packageName), `${commitPrefix} (manifest)`);
    }

    return res.status(200).json({
      ok: true,
      repo: GH_REPO,
      owner: GH_OWNER,
      branch: GH_BRANCH,
      packageName,
      changed: [
        `${javaDirRel}/MainActivity.java`,
        `app/src/main/res/layout/activity_main.xml`,
        `app/src/main/res/values/strings.xml`,
        manifestSha ? undefined : `app/src/main/AndroidManifest.xml`,
      ].filter(Boolean),
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
