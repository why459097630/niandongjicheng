import { gh } from "./client";
import { cfg } from "../config";

export async function triggerBuild(payload: {
  runId: string; ref: string; sha: string; template: string;
}) {
  await gh.rest.repos.createDispatchEvent({
    owner: cfg.owner, repo: cfg.repo,
    event_type: cfg.dispatchEvent,
    client_payload: { runId: payload.runId, ref: payload.ref, sha: payload.sha, template: payload.template }
  });
}
