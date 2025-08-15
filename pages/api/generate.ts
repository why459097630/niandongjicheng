// /pages/api/generate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { pickTemplateByText, type Template } from './_lib/pickTemplateByText';

type Data =
  | { ok: true; template: Template }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Data>) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method Not Allowed' });
      return;
    }

    const bodyOrQuery = req.method === 'POST' ? req.body : req.query;
    const prompt = String(bodyOrQuery?.prompt ?? '');

    const template = pickTemplateByText(prompt);
    res.status(200).json({ ok: true, template });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message ?? 'Internal Error' });
  }
}
