import { NextRequest, NextResponse } from 'next/server';
import { startBuild } from '@/lib/build/startBuild';
import { BuildRequest } from '@/lib/build/types';
import { provisionStore } from '@/lib/build/provisionStore';
import { createClient } from '@/lib/supabase/server';
import { syncAuthUserProfile } from '@/lib/build/storage';
import { assertAdminAccess } from '@/lib/chat/assertAdminAccess';

type StartBuildRequestBody = Partial<BuildRequest> & {
  adminName?: string;
  adminPassword?: string;
  iconDataUrl?: string | null;
};

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || 'application/octet-stream';
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
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

function getFreeComboCooldownStartIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

export async function POST(request: NextRequest) {
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
          error: 'Please sign in with Google first.',
        },
        { status: 401 },
      );
    }

    try {
      await syncAuthUserProfile(supabase, user);
    } catch (profileError) {
      console.error('NDJC start-build: failed to sync profile', profileError);
    }

    const contentType = request.headers.get('content-type') || '';

    let appName = '';
    let moduleId = 'feature-showcase';
    let uiPackId = 'ui-pack-showcase-greenpink';
    let plan = 'pro';
    let iconUrl: string | null = null;
    let iconDataUrl: string | null = null;
    let adminName = '';
    let adminPassword = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();

      appName = String(formData.get('appName') || '').trim();
      moduleId = String(formData.get('module') || 'feature-showcase').trim();
      uiPackId = String(formData.get('uiPack') || 'ui-pack-showcase-greenpink').trim();
      plan = String(formData.get('plan') || 'pro').trim();
      iconUrl = String(formData.get('iconUrl') || '').trim() || null;
      adminName = String(formData.get('adminName') || '').trim().toLowerCase();
      adminPassword = String(formData.get('adminPassword') || '');

      const iconFile = formData.get('iconFile');
      if (iconFile instanceof File && iconFile.size > 0) {
        iconDataUrl = await fileToDataUrl(iconFile);
      }
    } else {
      const body = (await request.json()) as StartBuildRequestBody;

      appName = (body.appName || '').trim();
      moduleId = (body.module || 'feature-showcase').trim();
      uiPackId = (body.uiPack || 'ui-pack-showcase-greenpink').trim();
      plan = (body.plan || 'pro').trim();
      iconUrl = body.iconUrl || null;
      iconDataUrl = body.iconDataUrl || null;
      adminName = (body.adminName || '').trim().toLowerCase();
      adminPassword = body.adminPassword || '';
    }

    if (!appName) {
      return NextResponse.json(
        {
          ok: false,
          error: 'appName is required.',
        },
        { status: 400 },
      );
    }

    if (!adminName) {
      return NextResponse.json(
        {
          ok: false,
          error: 'adminName is required.',
        },
        { status: 400 },
      );
    }

    if (!isValidAdminEmail(adminName)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'adminName must be a valid email address between 5 and 100 characters.',
        },
        { status: 400 },
      );
    }

    if (!adminPassword) {
      return NextResponse.json(
        {
          ok: false,
          error: 'adminPassword is required.',
        },
        { status: 400 },
      );
    }

    if (!isValidAdminPassword(adminPassword)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'adminPassword must be between 6 and 64 characters.',
        },
        { status: 400 },
      );
    }

    if (plan !== "free") {
      return NextResponse.json(
        {
          ok: false,
          error: "Paid builds must go through Stripe checkout.",
        },
        { status: 403 },
      );
    }

    const adminCheck = await assertAdminAccess();
    const isAdmin = adminCheck.ok;
    const buildPriority = isAdmin ? "admin" : "free";

    if (!isAdmin) {
      const freeComboCooldownStart = getFreeComboCooldownStartIso();

      const { count: recentSameComboCount, error: recentSameComboError } = await supabase
        .from('builds')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('plan', 'free')
        .eq('module_name', moduleId)
        .eq('ui_pack_name', uiPackId)
        .gte('created_at', freeComboCooldownStart);

      if (recentSameComboError) {
        return NextResponse.json(
          {
            ok: false,
            error: recentSameComboError.message,
          },
          { status: 500 },
        );
      }

      if ((recentSameComboCount || 0) > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: 'This free module + UI combination has already been generated by your account in the last 24 hours. Please try again later or switch to a different module/UI combination.',
          },
          { status: 429 },
        );
      }
    }

    const provisionResult = await provisionStore({
      module: moduleId,
      plan,
      adminName,
      adminPassword,
    });

    if (!provisionResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: provisionResult.error,
        },
        { status: 400 },
      );
    }

    const payload: BuildRequest & {
      adminName?: string;
      storeId: string;
      iconDataUrl?: string | null;
      userId: string;
      buildPriority: "admin" | "free";
    } = {
      appName,
      module: moduleId,
      uiPack: uiPackId,
      plan,
      iconUrl,
      iconDataUrl,
      adminName,
      storeId: provisionResult.storeId,
      userId: user.id,
      buildPriority,
    };

    const result = await startBuild(supabase, payload);

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(
      {
        ...result,
        storeId: provisionResult.storeId,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to start build.',
      },
      { status: 500 },
    );
  }
}
