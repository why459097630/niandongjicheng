// /pages/api/push-to-github.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { Octokit } from '@octokit/rest'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!
const REPO_OWNER = 'why459097630'
const REPO_NAME = 'Packaging-warehouse'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { html, css, js } = req.body
  if (!html || !css || !js) {
    return res.status(400).json({ error: 'Missing html/css/js' })
  }

  const timestamp = Date.now().toString()
  const folder = `app-${timestamp}`

  const octokit = new Octokit({ auth: GITHUB_TOKEN })

  try {
    await Promise.all([
      octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: `${folder}/index.html`,
        message: `Add HTML file at ${folder}`,
        content: Buffer.from(html).toString('base64'),
        committer: { name: 'AppBot', email: 'bot@example.com' },
        author: { name: 'AppBot', email: 'bot@example.com' },
      }),
      octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: `${folder}/styles.css`,
        message: `Add CSS file at ${folder}`,
        content: Buffer.from(css).toString('base64'),
        committer: { name: 'AppBot', email: 'bot@example.com' },
        author: { name: 'AppBot', email: 'bot@example.com' },
      }),
      octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: `${folder}/script.js`,
        message: `Add JS file at ${folder}`,
        content: Buffer.from(js).toString('base64'),
        committer: { name: 'AppBot', email: 'bot@example.com' },
        author: { name: 'AppBot', email: 'bot@example.com' },
      }),
    ])

    return res.status(200).json({
      success: true,
      repoUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/main/${folder}`,
      folder,
    })
  } catch (error: any) {
    console.error('Upload failed:', error)
    return res.status(500).json({ error: 'Failed to upload to GitHub', detail: error.message })
  }
}
