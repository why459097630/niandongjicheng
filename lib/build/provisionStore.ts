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

function isValidAdminEmail(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length >= 5 &&
    normalized.length <= 100 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  );
}

function isValidAdminPassword(value: string): boolean {
  return value.length >= 6 && value.length <= 64;
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

function isAuthUserAlreadyExistsError(data: unknown): boolean {
  if (typeof data === 'string') {
    const text = data.toLowerCase();
    return (
      text.includes('already been registered') ||
      text.includes('already registered') ||
      text.includes('user already registered') ||
      text.includes('email already exists') ||
      text.includes('duplicate key')
    );
  }

  if (typeof data === 'object' && data !== null) {
    const message = String(
      (data as { message?: unknown; msg?: unknown; error_description?: unknown }).message ||
        (data as { message?: unknown; msg?: unknown; error_description?: unknown }).msg ||
        (data as { message?: unknown; msg?: unknown; error_description?: unknown }).error_description ||
        '',
    ).toLowerCase();

    return (
      message.includes('already been registered') ||
      message.includes('already registered') ||
      message.includes('user already registered') ||
      message.includes('email already exists') ||
      message.includes('duplicate key')
    );
  }

  return false;
}

async function findExistingAuthUserIdByEmail(params: {
  supabaseUrl: string;
  headers: HeadersInit;
  email: string;
}): Promise<{ ok: true; authUserId: string } | { ok: false; error: string }> {
  const { supabaseUrl, headers, email } = params;

  const lookupResponse = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`,
    {
      method: 'GET',
      headers,
      cache: 'no-store',
    },
  );

  const lookupData = (await safeReadJson(lookupResponse)) as
    | {
        users?: Array<{
          id?: string;
          email?: string;
        }>;
        message?: string;
        msg?: string;
      }
    | string
    | null;

  console.log('NDJC provisionStore: auth users lookup response', {
    status: lookupResponse.status,
    ok: lookupResponse.ok,
    data: lookupData,
  });

  if (!lookupResponse.ok) {
    return {
      ok: false,
      error:
        typeof lookupData === 'string'
          ? lookupData
          : lookupData?.message || lookupData?.msg || 'Failed to query existing Supabase Auth users.',
    };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const authUserId =
    typeof lookupData === 'object' && lookupData !== null && Array.isArray(lookupData.users)
      ? String(
          lookupData.users.find((user) => String(user?.email || '').trim().toLowerCase() === normalizedEmail)?.id || '',
        ).trim()
      : '';

  if (!authUserId) {
    return {
      ok: false,
      error: 'Supabase Auth user already exists, but the user id could not be resolved by email.',
    };
  }

  return {
    ok: true,
    authUserId,
  };
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
  const supabaseUrl = (process.env.APP_CLOUD_SUPABASE_URL || '').trim();
  const secretKey = (process.env.APP_CLOUD_SUPABASE_SECRET_KEY || '').trim();

  if (!supabaseUrl) {
    return {
      ok: false,
      error: 'APP_CLOUD_SUPABASE_URL is required.',
    };
  }

  if (!secretKey) {
    return {
      ok: false,
      error: 'APP_CLOUD_SUPABASE_SECRET_KEY is required.',
    };
  }

  const moduleType = normalizeModuleType(input.module);
  const planType = normalizePlanType(input.plan);
  const adminName = input.adminName.trim().toLowerCase();
  const adminPassword = input.adminPassword;

  console.log('NDJC provisionStore: start', {
    moduleType,
    planType,
    adminName,
    supabaseUrl,
    supabaseUrlLength: supabaseUrl.length,
    secretKeyPrefix: secretKey.slice(0, 12),
    secretKeyLength: secretKey.length,
  });

  if (!adminName) {
    return {
      ok: false,
      error: 'adminName is required.',
    };
  }

  if (!isValidAdminEmail(adminName)) {
    return {
      ok: false,
      error: 'adminName must be a valid email address between 5 and 100 characters.',
    };
  }

  if (!adminPassword) {
    return {
      ok: false,
      error: 'adminPassword is required.',
    };
  }

  if (!isValidAdminPassword(adminPassword)) {
    return {
      ok: false,
      error: 'adminPassword must be between 6 and 64 characters.',
    };
  }

  const commonHeaders = {
    apikey: secretKey,
    'Content-Type': 'application/json',
  };

  try {
    const pingResponse = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: commonHeaders,
      cache: 'no-store',
    });

    console.log('NDJC provisionStore: supabase rest ping', {
      status: pingResponse.status,
      ok: pingResponse.ok,
      url: `${supabaseUrl}/rest/v1/`,
    });
  } catch (error) {
    console.error('NDJC provisionStore: supabase rest ping threw', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cause:
        error instanceof Error && 'cause' in error
          ? {
              name:
                error.cause instanceof Error
                  ? error.cause.name
                  : typeof error.cause,
              message:
                error.cause instanceof Error
                  ? error.cause.message
                  : String(error.cause),
              code:
                typeof error.cause === 'object' &&
                error.cause !== null &&
                'code' in error.cause
                  ? (error.cause as { code?: unknown }).code
                  : undefined,
            }
          : undefined,
      url: `${supabaseUrl}/rest/v1/`,
    });

    return {
      ok: false,
      error:
        error instanceof Error
          ? `supabase rest ping threw: ${error.message}`
          : 'supabase rest ping threw.',
    };
  }

  console.log('NDJC provisionStore: calling allocate_store_id', {
    moduleType,
    planType,
    url: `${supabaseUrl}/rest/v1/rpc/allocate_store_id`,
    headers: {
      hasApiKey: Boolean(commonHeaders.apikey),
      contentType: commonHeaders['Content-Type'],
    },
  });

  let allocateResponse: Response;
  try {
    allocateResponse = await fetch(
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
  } catch (error) {
    console.error('NDJC provisionStore: allocate_store_id fetch threw', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      cause:
        error instanceof Error && 'cause' in error
          ? {
              name:
                error.cause instanceof Error
                  ? error.cause.name
                  : typeof error.cause,
              message:
                error.cause instanceof Error
                  ? error.cause.message
                  : String(error.cause),
              code:
                typeof error.cause === 'object' &&
                error.cause !== null &&
                'code' in error.cause
                  ? (error.cause as { code?: unknown }).code
                  : undefined,
            }
          : undefined,
      url: `${supabaseUrl}/rest/v1/rpc/allocate_store_id`,
    });

    return {
      ok: false,
      error:
        error instanceof Error
          ? `allocate_store_id fetch threw: ${error.message}`
          : 'allocate_store_id fetch threw.',
    };
  }

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

  console.log('NDJC provisionStore: looking up existing store_memberships by login_name', {
    adminName,
  });

  const existingMembershipResponse = await fetch(
    `${supabaseUrl}/rest/v1/store_memberships?select=auth_user_id,login_name&login_name=eq.${encodeURIComponent(adminName)}&order=created_at.asc&limit=1`,
    {
      method: 'GET',
      headers: commonHeaders,
      cache: 'no-store',
    },
  );

  const existingMembershipData = (await safeReadJson(existingMembershipResponse)) as
    | Array<{
        auth_user_id?: string | null;
        login_name?: string | null;
      }>
    | string
    | null;

  console.log('NDJC provisionStore: existing store_memberships lookup response', {
    status: existingMembershipResponse.status,
    ok: existingMembershipResponse.ok,
    data: existingMembershipData,
  });

  if (!existingMembershipResponse.ok) {
    return {
      ok: false,
      error:
        typeof existingMembershipData === 'string'
          ? existingMembershipData
          : 'Failed to query existing store_memberships row.',
    };
  }

  let authUserId =
    Array.isArray(existingMembershipData) && existingMembershipData.length > 0
      ? String(existingMembershipData[0]?.auth_user_id || '').trim()
      : '';

  if (!authUserId) {
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
          error_description?: string;
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

      if (isAuthUserAlreadyExistsError(authData)) {
        console.log('NDJC provisionStore: auth user already exists, resolving by email', {
          storeId,
          adminName,
        });

        const existingAuthLookup = await findExistingAuthUserIdByEmail({
          supabaseUrl,
          headers: commonHeaders,
          email: adminName,
        });

        if (!existingAuthLookup.ok) {
          return {
            ok: false,
            error: existingAuthLookup.error,
          };
        }

        authUserId = existingAuthLookup.authUserId;

        console.log('NDJC provisionStore: resolved existing auth user by email', {
          storeId,
          adminName,
          authUserId,
        });
      } else {
        return {
          ok: false,
          error:
            typeof authData === 'string'
              ? authData
              : authData?.message ||
                authData?.msg ||
                authData?.error_description ||
                'Failed to create Supabase Auth user.',
        };
      }
    } else {
      authUserId =
        typeof authData === 'object' && authData !== null
          ? (authData.id || authData.user?.id || '').trim()
          : '';

      if (!authUserId) {
        return {
          ok: false,
          error: 'Supabase Auth user id is empty.',
        };
      }
    }
  } else {
    console.log('NDJC provisionStore: reusing existing auth user', {
      storeId,
      adminName,
      authUserId,
    });
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
