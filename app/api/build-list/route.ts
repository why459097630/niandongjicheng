import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getBuildList } from "@/lib/build/getBuildList";
import { insertOperationLogOnce, syncAuthUserProfile } from "@/lib/build/storage";
import type { BuildHistoryItem, CloudServiceStatus } from "@/lib/build/types";

type AppCloudStoreRow = {
  store_id: string;
  service_status: CloudServiceStatus;
  is_write_allowed: boolean;
  service_end_at: string | null;
  delete_at: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        {
          ok: false,
          items: [],
          error: "Please sign in with Google first.",
        },
        { status: 401 },
      );
    }

    try {
      await syncAuthUserProfile(supabase, user);
    } catch (profileError) {
      console.error("NDJC build-list: failed to sync profile", profileError);
    }

    const shouldLogOpen = request.nextUrl.searchParams.get("logOpen") === "1";

    if (shouldLogOpen) {
      try {
        await insertOperationLogOnce(
          supabase,
          {
            userId: user.id,
            eventName: "history_opened",
            pagePath: "/history",
            metadata: {
              source: "history_page",
            },
          },
          { dedupeSeconds: 30 },
        );
      } catch (logError) {
        console.error("NDJC build-list: failed to write history_opened log", logError);
      }
    }

    const result = await getBuildList(supabase, user.id);

    if (!result.ok || !result.items || result.items.length === 0) {
      return NextResponse.json(result, { status: 200 });
    }

    const appCloudUrl = process.env.APP_CLOUD_SUPABASE_URL;
    const appCloudServiceRoleKey = process.env.APP_CLOUD_SUPABASE_SERVICE_ROLE_KEY;

    if (!appCloudUrl || !appCloudServiceRoleKey) {
      return NextResponse.json(result, { status: 200 });
    }

    const storeIds = Array.from(
      new Set(
        result.items
          .map((item) => item.storeId)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
      ),
    );

    if (storeIds.length === 0) {
      return NextResponse.json(result, { status: 200 });
    }

    const appCloudSupabase = createSupabaseClient(
      appCloudUrl,
      appCloudServiceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const { data: stores, error: storesError } = await appCloudSupabase
      .from("stores")
      .select("store_id, service_status, is_write_allowed, service_end_at, delete_at")
      .in("store_id", storeIds);

    if (storesError) {
      console.error("NDJC build-list: failed to load stores", storesError);
      return NextResponse.json(result, { status: 200 });
    }

    const storeMap = new Map<string, AppCloudStoreRow>(
      ((stores || []) as AppCloudStoreRow[]).map((row) => [row.store_id, row]),
    );

    const mergedItems: BuildHistoryItem[] = result.items.map((item) => {
      const store = item.storeId ? storeMap.get(item.storeId) : undefined;

      return {
        ...item,
        cloudStatus: store?.service_status,
        cloudExpiresAt: store?.service_end_at ?? null,
        cloudDeletesAt: store?.delete_at ?? null,
        isWriteAllowed: store?.is_write_allowed,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        items: mergedItems,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        items: [],
        error: error instanceof Error ? error.message : "Failed to load build list.",
      },
      { status: 500 },
    );
  }
}