import { NextRequest, NextResponse } from 'next/server';
import { startBuild } from '@/lib/build/startBuild';
import { BuildRequest } from '@/lib/build/types';
import { provisionStore } from '@/lib/build/provisionStore';

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

export async function POST(request: NextRequest) {
  try {
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
      adminName = String(formData.get('adminName') || '').trim();
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
      adminName = (body.adminName || '').trim();
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
      storeId: string;
      iconDataUrl?: string | null;
    } = {
      appName,
      module: moduleId,
      uiPack: uiPackId,
      plan,
      iconUrl,
      iconDataUrl,
      adminName,
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
