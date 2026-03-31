import { NextRequest, NextResponse } from 'next/server';
import { startBuild } from '@/lib/build/startBuild';
import { BuildRequest } from '@/lib/build/types';
import { provisionStore } from '@/lib/build/provisionStore';

type StartBuildRequestBody = Partial<BuildRequest> & {
  adminName?: string;
  adminPassword?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as StartBuildRequestBody;

    const appName = (body.appName || '').trim();
    const moduleId = (body.module || 'feature-showcase').trim();
    const uiPackId = (body.uiPack || 'ui-pack-showcase-greenpink').trim();
    const plan = (body.plan || 'pro').trim();
    const iconUrl = body.iconUrl || null;
    const adminName = (body.adminName || '').trim();
    const adminPassword = body.adminPassword || '';

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

    if (!adminPassword) {
      return NextResponse.json(
        {
          ok: false,
          error: 'adminPassword is required.',
        },
        { status: 400 },
      );
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
      adminPassword?: string;
      storeId: string;
    } = {
      appName,
      module: moduleId,
      uiPack: uiPackId,
      plan,
      iconUrl,
      adminName,
      adminPassword,
      storeId: provisionResult.storeId,
    };

    const result = await startBuild(payload);

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
