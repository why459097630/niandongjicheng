import { Octokit } from "octokit";
import { cfg } from "../config";
export const gh = new Octokit({ auth: cfg.token });
