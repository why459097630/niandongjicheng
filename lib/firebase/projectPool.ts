import type { SupabaseClient } from "@supabase/supabase-js";

type FirebasePoolType = "free" | "paid";

type BuildPoolRow = {
  store_id: string | null;
  created_at: string;
  plan: string | null;
};

export type FirebaseProjectAssignment = {
  poolType: FirebasePoolType;
  firebaseProjectId: string;
  firebaseCredentialsEnvKey: string;
  firebaseProjectBucket: number;
  firebaseProjectSlot: number;
  appLimit: number;
};

function normalizePoolType(plan: string): FirebasePoolType {
  const value = (plan || "").trim().toLowerCase();
  return value === "free" ? "free" : "paid";
}

function parseCsvEnv(name: string): string[] {
  const raw = (process.env[name] || "").trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getAppLimit(): number {
  const raw = (process.env.FIREBASE_PROJECT_APP_LIMIT || "30").trim();
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("FIREBASE_PROJECT_APP_LIMIT must be a positive integer.");
  }

  return parsed;
}

function getPoolConfig(plan: string): {
  poolType: FirebasePoolType;
  projectIds: string[];
  credentialEnvKeys: string[];
  appLimit: number;
} {
  const poolType = normalizePoolType(plan);

  const projectIds =
    poolType === "free"
      ? parseCsvEnv("FIREBASE_FREE_PROJECT_IDS")
      : parseCsvEnv("FIREBASE_PAID_PROJECT_IDS");

  const credentialEnvKeys =
    poolType === "free"
      ? parseCsvEnv("FIREBASE_FREE_CREDENTIAL_ENV_KEYS")
      : parseCsvEnv("FIREBASE_PAID_CREDENTIAL_ENV_KEYS");

  const appLimit = getAppLimit();

  if (projectIds.length === 0) {
    throw new Error(
      poolType === "free"
        ? "FIREBASE_FREE_PROJECT_IDS is required."
        : "FIREBASE_PAID_PROJECT_IDS is required.",
    );
  }

  if (credentialEnvKeys.length === 0) {
    throw new Error(
      poolType === "free"
        ? "FIREBASE_FREE_CREDENTIAL_ENV_KEYS is required."
        : "FIREBASE_PAID_CREDENTIAL_ENV_KEYS is required.",
    );
  }

  if (projectIds.length !== credentialEnvKeys.length) {
    throw new Error(
      poolType === "free"
        ? "FIREBASE_FREE_PROJECT_IDS and FIREBASE_FREE_CREDENTIAL_ENV_KEYS length mismatch."
        : "FIREBASE_PAID_PROJECT_IDS and FIREBASE_PAID_CREDENTIAL_ENV_KEYS length mismatch.",
    );
  }

  return {
    poolType,
    projectIds,
    credentialEnvKeys,
    appLimit,
  };
}

export async function resolveFirebaseProjectAssignment(
  supabase: SupabaseClient,
  input: {
    plan: string;
    storeId: string;
  },
): Promise<FirebaseProjectAssignment> {
  const storeId = (input.storeId || "").trim();

  if (!storeId) {
    throw new Error("storeId is required for Firebase project assignment.");
  }

  const { poolType, projectIds, credentialEnvKeys, appLimit } = getPoolConfig(
    input.plan,
  );

  let query = supabase
    .from("builds")
    .select("store_id, created_at, plan")
    .not("store_id", "is", null)
    .order("created_at", { ascending: true });

  if (poolType === "free") {
    query = query.eq("plan", "free");
  } else {
    query = query.neq("plan", "free");
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Failed to resolve Firebase project assignment: ${error.message}`,
    );
  }

  const rows = (data || []) as BuildPoolRow[];

  const orderedStoreIds: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const currentStoreId = String(row.store_id || "").trim();

    if (!currentStoreId || seen.has(currentStoreId)) {
      continue;
    }

    seen.add(currentStoreId);
    orderedStoreIds.push(currentStoreId);
  }

  if (!seen.has(storeId)) {
    orderedStoreIds.push(storeId);
  }

  const storeIndex = orderedStoreIds.indexOf(storeId);

  if (storeIndex < 0) {
    throw new Error("Failed to determine Firebase project bucket index.");
  }

  const firebaseProjectBucket = Math.floor(storeIndex / appLimit);

  if (firebaseProjectBucket >= projectIds.length) {
    throw new Error(
      `${poolType} Firebase project pool exhausted. Add another Firebase project and matching credential env key.`,
    );
  }

  const firebaseProjectSlot = storeIndex % appLimit;

  return {
    poolType,
    firebaseProjectId: projectIds[firebaseProjectBucket],
    firebaseCredentialsEnvKey:
      credentialEnvKeys[firebaseProjectBucket],
    firebaseProjectBucket,
    firebaseProjectSlot,
    appLimit,
  };
}