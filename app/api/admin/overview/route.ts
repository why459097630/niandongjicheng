import { NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * NDJC Admin Overview（最终稳定版）
 * - 前端网站库：profiles / builds / user_operation_logs
 * - App 云端库：stores
 * - 两套 Supabase 完全隔离
 */

export async function GET() {
  try {
    /**
     * 1️⃣ 登录校验（走前端网站 Supabase anon）
     */
    const authClient = await createServerSupabase();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "Please sign in first." },
        { status: 401 }
      );
    }

    /**
     * 2️⃣ 前端网站 Supabase（只查 profiles / builds / logs）
     * ⚠️ 强制用 NEXT_PUBLIC_SUPABASE_URL，不允许 fallback
     */
    const frontendUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
    const frontendServiceRole =
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";

    if (!frontendUrl || !frontendServiceRole) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
    }

    const frontendAdmin = createSupabaseClient(
      frontendUrl,
      frontendServiceRole,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    /**
     * 3️⃣ 查询前端网站数据（核心）
     */
    const [profilesResult, buildsResult, logsResult] = await Promise.all([
      frontendAdmin.from("profiles").select("*"),
      frontendAdmin.from("builds").select("*"),
      frontendAdmin.from("user_operation_logs").select("*").limit(5000),
    ]);

    if (profilesResult.error) {
      throw new Error(
        `profiles error: ${profilesResult.error.message}`
      );
    }

    if (buildsResult.error) {
      throw new Error(
        `builds error: ${buildsResult.error.message}`
      );
    }

    if (logsResult.error) {
      throw new Error(
        `logs error: ${logsResult.error.message}`
      );
    }

    const profiles = profilesResult.data || [];
    const builds = buildsResult.data || [];
    const logs = logsResult.data || [];

    /**
     * 4️⃣ App 云端 Supabase（只查 stores）
     */
    let stores: any[] = [];

    const appCloudUrl = process.env.APP_CLOUD_SUPABASE_URL;
    const appCloudServiceRole =
      process.env.APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY;

    if (appCloudUrl && appCloudServiceRole) {
      const appCloudAdmin = createSupabaseClient(
        appCloudUrl,
        appCloudServiceRole,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );

      const storesResult = await appCloudAdmin
        .from("stores")
        .select("*");

      if (!storesResult.error) {
        stores = storesResult.data || [];
      }
    }

    /**
     * 5️⃣ 简化返回（先验证链路）
     */
    return NextResponse.json({
      ok: true,
      debug: {
        profiles: profiles.length,
        builds: builds.length,
        logs: logs.length,
        stores: stores.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "admin overview failed",
      },
      { status: 500 }
    );
  }
}
