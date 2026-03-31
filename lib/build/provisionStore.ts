import crypto from 'node:crypto';

export type ProvisionStoreInput = {
  module: string;
  plan: string;
  adminName: string;
  adminPassword: string;
};

export type ProvisionStoreResult =
  | {
      ok: true;
      storeId: string;
      authUserId: string;
      planType: 'trial' | 'paid';
      moduleType: string;
    }
  | {
      ok: false;
      error: string;
    };

function normalizeModuleType(moduleId: string): string {
  const value = moduleId.trim().toLowerCase();
  if (value === 'feature-showcase') return 'showcase';
  return value.replace(/^feature-/, '') || 'showcase';
}

function normalizePlanType(plan: string): 'trial' | 'paid' {
  const value = plan.trim().toLowerCase();
  if (value === 'free' || value === 'trial') return 'trial';
  return 'paid';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function formatIso(date: Date): string {
  return date.toISOString();
}

function computeLifecycle(planType: 'trial' | 'paid') {
  const now = new Date();

  const serviceEndAt = new Date(now);
  const deleteAt = new Date(now);

  if (planType === 'trial') {
    serviceEndAt.setDate(serviceEndAt.getDate() + 7);
    deleteAt.setDate(deleteAt.getDate() + 10);
  } else {
    serviceEndAt.setDate(serviceEndAt.getDate() + 30);
    deleteAt.setDate(deleteAt.getDate() + 60);
  }

  return {
    serviceStartAt: formatIso(now),
    serviceEndAt: formatIso(serviceEndAt),
    deleteAt: formatIso(deleteAt),
  };
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractStoreIdFromRpc(data: unknown): string {
  if (typeof data === 'string') {
    return data.trim();
  }

  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (typeof first === 'string') {
      return first.trim();
    }
    if (first && typeof first === 'object' && 'store_id' in first) {
      const value = (first as { store_id?: unknown }).store_id;
      return typeof value === 'string' ? value.trim() : '';
    }
  }

  if (data && typeof data === 'object' && 'store_id' in data) {
    const value = (data as { store_id?: unknown }).store_id;
    return typeof value === 'string' ? value.trim() : '';
  }

  return '';
}

export async function provisionStore(
  input: ProvisionStoreInput,
): Promise<ProvisionStoreResult> {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl) {
    return {
      ok: false,
      error: 'SUPABASE_URL is required.',
    };
  }

  if (!serviceRoleKey) {
    return {
      ok: false,
      error: 'SUPABASE_SERVICE_ROLE_KEY is required.',
    };
  }

  const moduleType = normalizeModuleType(input.module);
  const planType = normalizePlanType(input.plan);
  const adminName = input.adminName.trim();
  const adminPassword = input.adminPassword;

  console.log('NDJC provisionStore: start', {
    moduleType,
    planType,
    adminName,
    supabaseUrl,
  });

  if (!adminName) {
    return {
      ok: false,
      error: 'adminName is required.',
    };
  }

  if (!isValidEmail(adminName)) {
    return {
      ok: false,
      error: 'adminName must be a valid email address.',
    };
  }

  if (!adminPassword) {
    return {
      ok: false,
      error: 'adminPassword is required.',
    };
  }

  if (adminPassword.length < 6) {
    return {
      ok: false,
      error: 'adminPassword must be at least 6 characters.',
    };
  }

  const commonHeaders = {
    apikey: serviceRoleKey,
    'Content-Type': 'application/json',
  };

  console.log('NDJC provisionStore: calling allocate_store_id', {
    moduleType,
    planType,
  });

  const allocateResponse = await fetch(
    `${supabaseUrl}/rest/v1/rpc/allocate_store_id`,
    {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({
        p_module_type: moduleType,
        p_plan_type: planType,
      }),
      cache: 'no-store',
    },
  );

  const allocateData = await safeReadJson(allocateResponse);

  console.log('NDJC provisionStore: allocate_store_id response', {
    status: allocateResponse.status,
    ok: allocateResponse.ok,
    data: allocateData,
  });

  if (!allocateResponse.ok) {
    console.error('NDJC provisionStore: allocate_store_id failed', {
      status: allocateResponse.status,
      data: allocateData,
    });

    return {
      ok: false,
      error:
        typeof allocateData === 'string'
          ? allocateData
          : 'Failed to allocate store id.',
    };
  }

  const storeId = extractStoreIdFromRpc(allocateData);

  console.log('NDJC provisionStore: extracted storeId', {
    storeId,
  });

  if (!storeId) {
    console.error('NDJC provisionStore: empty storeId after allocate_store_id', {
      data: allocateData,
    });

    return {
      ok: false,
      error: 'Supabase allocate_store_id returned empty store id.',
    };
  }

  const lifecycle = computeLifecycle(planType);

  console.log('NDJC provisionStore: upserting stores row', {
    storeId,
    moduleType,
    planType,
    lifecycle,
  });

  const storesResponse = await fetch(
    `${supabaseUrl}/rest/v1/stores?on_conflict=store_id`,
    {
      method: 'POST',
      headers: {
        ...commonHeaders,
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([
        {
          store_id: storeId,
          module_type: moduleType,
          plan_type: planType,
          service_status: 'active',
          is_write_allowed: true,
          service_start_at: lifecycle.serviceStartAt,
          service_end_at: lifecycle.serviceEndAt,
          delete_at: lifecycle.deleteAt,
        },
      ]),
      cache: 'no-store',
    },
  );

  const storesData = await safeReadJson(storesResponse);

  console.log('NDJC provisionStore: stores response', {
    status: storesResponse.status,
    ok: storesResponse.ok,
    data: storesData,
  });

  if (!storesResponse.ok) {
    console.error('NDJC provisionStore: stores upsert failed', {
      status: storesResponse.status,
      data: storesData,
    });

    return {
      ok: false,
      error:
        typeof storesData === 'string'
          ? storesData
          : 'Failed to upsert stores row.',
    };
  }

  console.log('NDJC provisionStore: creating auth user', {
    storeId,
    adminName,
  });

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify({
      email: adminName,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        store_id: storeId,
        module_type: moduleType,
        plan_type: planType,
        provision_trace: crypto.randomUUID(),
      },
    }),
    cache: 'no-store',
  });

  const authData = (await safeReadJson(authResponse)) as
    | {
        id?: string;
        user?: {
          id?: string;
        };
        msg?: string;
        message?: string;
      }
    | string
    | null;

  console.log('NDJC provisionStore: auth response', {
    status: authResponse.status,
    ok: authResponse.ok,
    data: authData,
  });

  if (!authResponse.ok) {
    console.error('NDJC provisionStore: auth create failed', {
      status: authResponse.status,
      data: authData,
    });

    return {
      ok: false,
      error:
        typeof authData === 'string'
          ? authData
          : authData?.message ||
            authData?.msg ||
            'Failed to create Supabase Auth user.',
    };
  }

  const authUserId =
    typeof authData === 'object' && authData !== null
      ? (authData.id || authData.user?.id || '').trim()
      : '';

  if (!authUserId) {
    return {
      ok: false,
      error: 'Supabase Auth user id is empty.',
    };
  }

  console.log('NDJC provisionStore: upserting store_memberships row', {
    storeId,
    authUserId,
    adminName,
  });

  const membershipResponse = await fetch(
    `${supabaseUrl}/rest/v1/store_memberships?on_conflict=store_id`,
    {
      method: 'POST',
      headers: {
        ...commonHeaders,
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([
        {
          store_id: storeId,
          auth_user_id: authUserId,
          login_name: adminName,
          is_active: true,
        },
      ]),
      cache: 'no-store',
    },
  );

  const membershipData = await safeReadJson(membershipResponse);

  console.log('NDJC provisionStore: store_memberships response', {
    status: membershipResponse.status,
    ok: membershipResponse.ok,
    data: membershipData,
  });

  if (!membershipResponse.ok) {
    console.error('NDJC provisionStore: store_memberships upsert failed', {
      status: membershipResponse.status,
      data: membershipData,
    });

    return {
      ok: false,
      error:
        typeof membershipData === 'string'
          ? membershipData
          : 'Failed to upsert store_memberships row.',
    };
  }

  console.log('NDJC provisionStore: success', {
    storeId,
    authUserId,
    planType,
    moduleType,
  });

  return {
    ok: true,
    storeId,
    authUserId,
    planType,
    moduleType,
  };
}
