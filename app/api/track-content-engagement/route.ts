import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type DishAction = "dish_view" | "dish_click";
type AnnouncementAction = "announcement_view";
type ActionType = DishAction | AnnouncementAction;

type Body = {
  storeId?: string | null;
  action?: ActionType | null;
  dishId?: string | null;
  announcementId?: string | null;
};

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const appCloudUrl = process.env.APP_CLOUD_SUPABASE_URL?.trim() || "";
    const appCloudAnonKey =
      process.env.NEXT_PUBLIC_APP_CLOUD_SUPABASE_ANON_KEY?.trim() ||
      process.env.APP_CLOUD_SUPABASE_ANON_KEY?.trim() ||
      "";

    if (!appCloudUrl || !appCloudAnonKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing APP_CLOUD_SUPABASE_URL or APP_CLOUD_SUPABASE_ANON_KEY / NEXT_PUBLIC_APP_CLOUD_SUPABASE_ANON_KEY.",
        },
        { status: 500 },
      );
    }

    const body = (await request.json()) as Body;
    const storeId = (body.storeId || "").trim();
    const action = (body.action || "").trim() as ActionType;
    const dishId = (body.dishId || "").trim();
    const announcementId = (body.announcementId || "").trim();

    if (!storeId) {
      return NextResponse.json(
        {
          ok: false,
          error: "storeId is required.",
        },
        { status: 400 },
      );
    }

    if (!action) {
      return NextResponse.json(
        {
          ok: false,
          error: "action is required.",
        },
        { status: 400 },
      );
    }

    const appCloud = createSupabaseClient(appCloudUrl, appCloudAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          "x-ndjc-store-id": storeId,
        },
      },
    });

    if (action === "dish_view") {
      if (!dishId || !isUuidLike(dishId)) {
        return NextResponse.json(
          {
            ok: false,
            error: "dishId is required and must be a valid uuid for dish_view.",
          },
          { status: 400 },
        );
      }

      const { error } = await appCloud.rpc("ndjc_inc_dish_view_count", {
        p_store_id: storeId,
        p_dish_id: dishId,
      });

      if (error) {
        throw new Error(error.message);
      }

      return NextResponse.json({ ok: true });
    }

    if (action === "dish_click") {
      if (!dishId || !isUuidLike(dishId)) {
        return NextResponse.json(
          {
            ok: false,
            error: "dishId is required and must be a valid uuid for dish_click.",
          },
          { status: 400 },
        );
      }

      const { error } = await appCloud.rpc("ndjc_inc_dish_click_count", {
        p_store_id: storeId,
        p_dish_id: dishId,
      });

      if (error) {
        throw new Error(error.message);
      }

      return NextResponse.json({ ok: true });
    }

    if (action === "announcement_view") {
      if (!announcementId) {
        return NextResponse.json(
          {
            ok: false,
            error: "announcementId is required for announcement_view.",
          },
          { status: 400 },
        );
      }

      const { error } = await appCloud.rpc("ndjc_inc_announcement_view_count", {
        p_store_id: storeId,
        p_announcement_id: announcementId,
      });

      if (error) {
        throw new Error(error.message);
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Unsupported action.",
      },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to track content engagement.",
      },
      { status: 500 },
    );
  }
}