import type { SupabaseClient } from "@supabase/supabase-js";
import { getBuildRecordByRunId, updateBuildRecordByRunId } from "./storage";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function githubRequest(
  url: string,
  init: RequestInit & { token: string },
): Promise<Response> {
  const { token, headers, ...rest } = init;

  return fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    cache: "no-store",
  });
}

function getConcurrencyLimit(): number {
  const rawConcurrencyLimit = (process.env.BUILD_CONCURRENCY_LIMIT || "20").trim();
  const parsedConcurrencyLimit = Number.parseInt(rawConcurrencyLimit, 10);

  if (Number.isFinite(parsedConcurrencyLimit) && parsedConcurrencyLimit > 0) {
    return parsedConcurrencyLimit;
  }

  return 20;
}

async function claimNextQueuedBuild(
  supabase: SupabaseClient,
  preferredRunId?: string,
): Promise<string | null> {
  const concurrencyLimit = getConcurrencyLimit();

  const { data, error } = await supabase.rpc("claim_next_queued_build", {
    p_limit: concurrencyLimit,
    p_preferred_run_id: preferredRunId ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!Array.isArray(data) || !data[0]?.run_id) {
    return null;
  }

  return String(data[0].run_id);
}

async function triggerBuildWorkflow(runId: string): Promise<void> {
  const token = getRequiredEnv("GH_TOKEN");
  const owner = getRequiredEnv("GH_OWNER");
  const repo = getRequiredEnv("GH_REPO");
  const branch = getRequiredEnv("GH_BRANCH");
  const workflowId = getRequiredEnv("WORKFLOW_ID");

  const response = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      token,
      body: JSON.stringify({
        ref: branch,
        inputs: {
          run_id: runId,
        },
      }),
    },
  );

  const data = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to dispatch workflow: ${data}`);
  }
}

export async function releaseNextQueuedBuild(
  supabase: SupabaseClient,
  preferredRunId?: string,
): Promise<{ released: boolean; runId?: string }> {
  const claimedRunId = await claimNextQueuedBuild(supabase, preferredRunId);

  if (!claimedRunId) {
    return { released: false };
  }

  const claimedRecord = await getBuildRecordByRunId(supabase, claimedRunId);

  if (!claimedRecord) {
    return { released: false };
  }

  try {
    await triggerBuildWorkflow(claimedRecord.runId);

    await updateBuildRecordByRunId(supabase, claimedRecord.runId, {
      status: "running",
      stage: "preparing_request",
      message:
        "Packaging workflow dispatched successfully. Preparing build request.",
      error: null,
      statusSource: "local_api",
    });

    return {
      released: true,
      runId: claimedRecord.runId,
    };
  } catch (error) {
    await updateBuildRecordByRunId(supabase, claimedRecord.runId, {
      status: "queued",
      stage: "queued",
      message: "Your request has been received and is waiting for an available build slot.",
      error: null,
      statusSource: "local_api",
    }).catch(() => null);

    console.error("NDJC releaseNextQueuedBuild: failed to release queued build", {
      runId: claimedRecord.runId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return { released: false };
  }
}