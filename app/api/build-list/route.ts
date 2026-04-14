import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getBuildList } from "@/lib/build/getBuildList";
import { insertOperationLogOnce, syncAuthUserProfile } from "@/lib/build/storage";
import type {
  BuildHistoryItem,
  CloudServiceStatus,
  PaymentCompensationStatus,
  PaymentOrderStatus,
} from "@/lib/build/types";

type AppCloudStoreRow = {
  store_id: string;
  service_status: CloudServiceStatus;
  is_write_allowed: boolean;
  service_end_at: string | null;
  delete_at: string | null;
};

type StripeOrderLiteRow = {
  id: string;
  order_kind: "generate_app" | "renew_cloud";
  user_id: string;
  run_id: string | null;
  store_id: string | null;
  status: PaymentOrderStatus;
  compensation_status: PaymentCompensationStatus | null;
  compensation_note: string | null;
  next_retry_at: string | null;
  manual_review_required_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeStripeOrderRows(rows: unknown): StripeOrderLiteRow[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows as StripeOrderLiteRow[];
}

function getWebServiceSupabase() {
  const supabaseUrl = (process.env.WEB_SUPABASE_URL || "").trim();
  const supabaseSecretKey = (process.env.WEB_SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!supabaseUrl || !supabaseSecretKey) {
    return null;
  }

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function deriveCloudStatus(store: AppCloudStoreRow | undefined, nowMs: number): CloudServiceStatus | undefined {
  if (!store) return undefined;

  const deleteAtMs = store.delete_at ? new Date(store.delete_at).getTime() : Number.NaN;
  if (Number.isFinite(deleteAtMs) && deleteAtMs <= nowMs) {
    return "deleted";
  }

  const serviceEndMs = store.service_end_at ? new Date(store.service_end_at).getTime() : Number.NaN;
  if (Number.isFinite(serviceEndMs) && serviceEndMs <= nowMs) {
    return "read_only";
  }

  if (store.service_status === "deleted") return "deleted";
  if (store.service_status === "read_only") return "read_only";
  return "active";
}

function deriveWriteAllowed(store: AppCloudStoreRow | undefined, nowMs: number): boolean | undefined {
  if (!store) return undefined;
  return deriveCloudStatus(store, nowMs) === "active" && store.is_write_allowed !== false;
}

function keepLatestByUpdatedAt(rows: StripeOrderLiteRow[]): Map<string, StripeOrderLiteRow> {
  const map = new Map<string, StripeOrderLiteRow>();

  for (const row of rows) {
    const key = row.order_kind === "generate_app" ? row.run_id || "" : row.store_id || "";

    if (!key) {
      continue;
    }

    const prev = map.get(key);

    if (!prev) {
      map.set(key, row);
      continue;
    }

    const prevMs = new Date(prev.updated_at || prev.created_at).getTime();
    const rowMs = new Date(row.updated_at || row.created_at).getTime();

    if (!Number.isFinite(prevMs) || rowMs >= prevMs) {
      map.set(key, row);
    }
  }

  return map;
}

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

    const appCloudUrl = (process.env.APP_CLOUD_SUPABASE_URL || "").trim();
    const appCloudSecretKey = (process.env.APP_CLOUD_SUPABASE_SECRET_KEY || "").trim();

    const storeIds = Array.from(
      new Set(
        result.items
          .map((item) => item.storeId)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
      ),
    );

    const runIds = Array.from(
      new Set(
        result.items
          .map((item) => item.runId)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
      ),
    );

    let storeMap = new Map<string, AppCloudStoreRow>();

    if (appCloudUrl && appCloudSecretKey && storeIds.length > 0) {
      const appCloudSupabase = createSupabaseClient(
        appCloudUrl,
        appCloudSecretKey,
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
      } else {
        storeMap = new Map<string, AppCloudStoreRow>(
          ((stores || []) as AppCloudStoreRow[]).map((row) => [row.store_id, row]),
        );
      }
    }

    const serviceSupabase = getWebServiceSupabase();
    let buildOrderMap = new Map<string, StripeOrderLiteRow>();
    let renewOrderMap = new Map<string, StripeOrderLiteRow>();

    if (serviceSupabase) {
      if (runIds.length > 0) {
        const { data: generateOrders, error: generateOrdersError } = await serviceSupabase
          .from("web_stripe_orders")
          .select(
            [
              "id",
              "order_kind",
              "user_id",
              "run_id",
              "store_id",
              "status",
              "compensation_status",
              "compensation_note",
              "next_retry_at",
              "manual_review_required_at",
              "refunded_at",
              "created_at",
              "updated_at",
            ].join(","),
          )
          .eq("user_id", user.id)
          .eq("order_kind", "generate_app")
          .in("run_id", runIds)
          .order("updated_at", { ascending: false });

        if (generateOrdersError) {
          console.error("NDJC build-list: failed to load generate orders", generateOrdersError);
        } else {
          buildOrderMap = keepLatestByUpdatedAt(normalizeStripeOrderRows(generateOrders));
        }
      }

      if (storeIds.length > 0) {
        const { data: renewOrders, error: renewOrdersError } = await serviceSupabase
          .from("web_stripe_orders")
          .select(
            [
              "id",
              "order_kind",
              "user_id",
              "run_id",
              "store_id",
              "status",
              "compensation_status",
              "compensation_note",
              "next_retry_at",
              "manual_review_required_at",
              "refunded_at",
              "created_at",
              "updated_at",
            ].join(","),
          )
          .eq("user_id", user.id)
          .eq("order_kind", "renew_cloud")
          .in("store_id", storeIds)
          .order("updated_at", { ascending: false });

        if (renewOrdersError) {
          console.error("NDJC build-list: failed to load renew orders", renewOrdersError);
        } else {
          renewOrderMap = keepLatestByUpdatedAt(normalizeStripeOrderRows(renewOrders));
        }
      }
    }

    const nowMs = Date.now();

    const mergedItems: BuildHistoryItem[] = result.items.map((item) => {
      const store = item.storeId ? storeMap.get(item.storeId) : undefined;
      const buildOrder = buildOrderMap.get(item.runId);
      const renewOrder = item.storeId ? renewOrderMap.get(item.storeId) : undefined;

      return {
        ...item,
        cloudStatus: deriveCloudStatus(store, nowMs),
        cloudExpiresAt: store?.service_end_at ?? null,
        cloudDeletesAt: store?.delete_at ?? null,
        isWriteAllowed: deriveWriteAllowed(store, nowMs),

        buildOrderStatus: buildOrder?.status ?? null,
        buildCompensationStatus: buildOrder?.compensation_status ?? null,
        buildCompensationNote: buildOrder?.compensation_note ?? null,
        buildNextRetryAt: buildOrder?.next_retry_at ?? null,
        buildManualReviewRequiredAt: buildOrder?.manual_review_required_at ?? null,
        buildRefundedAt: buildOrder?.refunded_at ?? null,

        renewOrderStatus: renewOrder?.status ?? null,
        renewCompensationStatus: renewOrder?.compensation_status ?? null,
        renewCompensationNote: renewOrder?.compensation_note ?? null,
        renewNextRetryAt: renewOrder?.next_retry_at ?? null,
        renewManualReviewRequiredAt: renewOrder?.manual_review_required_at ?? null,
        renewRefundedAt: renewOrder?.refunded_at ?? null,
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