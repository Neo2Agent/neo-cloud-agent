import path from "node:path";
import type { Run, RunEvent } from "@neo-cloud-agent/contracts";
import { ControlPlaneClient } from "./client.js";
import { resolveApiToken, resolveApiUrl, saveStoredConfig, saveStoredCredentials, clearStoredCredentials } from "./config.js";
import { CliError, EXIT_OK, EXIT_USAGE } from "./errors.js";
import {
  accumulateAssistant,
  createFormatter,
  printJsonOrText,
  resultFrom,
  type CliResult,
  type ResultSubtype,
} from "./format.js";
import { question, readHidden, resolvePrompt } from "./input.js";
import type { CliIo } from "./io.js";
import { writeLine } from "./io.js";
import type { CliFlags, ParsedCli } from "./parse.js";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINAL = new Set(["IDLE", "ERROR", "ARCHIVED", "EXPIRED"]);

export function createClient(io: CliIo, flags: CliFlags): ControlPlaneClient {
  return new ControlPlaneClient({
    url: resolveApiUrl(io, flags.url),
    token: resolveApiToken(io, flags.apiKey),
  });
}

function requireArg(args: string[], label: string): string {
  const value = args[0]?.trim();
  if (!value) {
    throw new CliError(`${label} is required`, EXIT_USAGE);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveRepoUrls(client: ControlPlaneClient, flags: CliFlags, cwd: string): Promise<string[]> {
  const urls = [
    ...flags.repos,
    ...flags.dirs.map((dir) => path.resolve(cwd, dir)),
  ];
  if (urls.length > 0) {
    return urls;
  }
  if (flags.envId) {
    const env = await client.getEnvironment(flags.envId);
    const repos = env.config.repos ?? [];
    if (repos.length > 0) {
      return repos;
    }
  }
  throw new CliError("need --repo, --dir, or --env with repos", EXIT_USAGE);
}

function subtypeFor(status: string): ResultSubtype {
  if (status === "ERROR") return "error";
  if (status === "ARCHIVED" || status === "EXPIRED") return "aborted";
  return "success";
}

async function waitForTurn(
  client: ControlPlaneClient,
  run: Run,
  flags: CliFlags,
  io: CliIo,
  startedAt: number,
  priorEvents: RunEvent[] = [],
  after?: string,
): Promise<number> {
  const formatter = createFormatter(flags.output, io);
  formatter.init(run);
  const seen = new Set<string>();
  const collected: RunEvent[] = [];
  for (const event of priorEvents) {
    seen.add(event.id);
    collected.push(event);
    formatter.event(event);
  }

  const timeoutMs = flags.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastId = after ?? priorEvents.at(-1)?.id;
  let latest = run;

  const finish = (subtype: ResultSubtype, error?: string): number => {
    const assistant = accumulateAssistant(collected);
    const result: CliResult = resultFrom({
      subtype,
      run: latest,
      durationMs: Math.max(0, io.now() - startedAt),
      result: assistant || latest.errorMessage || latest.status,
      eventCount: collected.length,
      error: error ?? latest.errorMessage ?? undefined,
    });
    return formatter.finish(result);
  };

  if (TERMINAL.has(run.status) && priorEvents.length > 0) {
    return finish(subtypeFor(run.status), run.errorMessage ?? undefined);
  }

  const consume = (event: RunEvent) => {
    if (seen.has(event.id)) {
      return;
    }
    seen.add(event.id);
    collected.push(event);
    lastId = event.id;
    formatter.event(event);
  };

  const controller = new AbortController();
  const streaming = (async () => {
    while (!controller.signal.aborted && io.now() < startedAt + timeoutMs) {
      try {
        await client.streamEvents(run.id, consume, { after: lastId, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        if (error instanceof CliError && error.status === 401) {
          throw error;
        }
        writeLine(io.err, "event stream interrupted, retrying");
      }
      if (!controller.signal.aborted) {
        await sleep(400);
      }
    }
  })();

  try {
    while (io.now() < startedAt + timeoutMs) {
      latest = await client.getRun(run.id);
      if (TERMINAL.has(latest.status)) {
        break;
      }
      await sleep(250);
    }
    if (!TERMINAL.has(latest.status)) {
      latest = await client.getRun(run.id);
    }
    const transcript = await client.transcript(run.id);
    for (const event of transcript.events ?? []) {
      consume(event);
    }
    if (!TERMINAL.has(latest.status)) {
      return finish("timeout", `timed out after ${timeoutMs}ms`);
    }
    return finish(subtypeFor(latest.status), latest.errorMessage ?? undefined);
  } finally {
    controller.abort();
    await streaming.catch(() => undefined);
  }
}

async function replayAndMaybeWait(
  client: ControlPlaneClient,
  runId: string,
  flags: CliFlags,
  io: CliIo,
  startedAt: number,
  waitIfRunning: boolean,
): Promise<number> {
  const run = await client.getRun(runId);
  const transcript = await client.transcript(runId);
  if (!waitIfRunning || TERMINAL.has(run.status)) {
    const formatter = createFormatter(flags.output, io);
    formatter.init(run);
    const events = transcript.events ?? [];
    for (const event of events) {
      formatter.event(event);
    }
    return formatter.finish(
      resultFrom({
        subtype: subtypeFor(run.status),
        run,
        durationMs: Math.max(0, io.now() - startedAt),
        result: accumulateAssistant(events) || run.errorMessage || run.status,
        eventCount: events.length,
        error: run.errorMessage ?? undefined,
      }),
    );
  }
  return waitForTurn(client, run, flags, io, startedAt, transcript.events ?? []);
}

export async function loginCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const client = createClient(io, parsed.flags);
  if (parsed.flags.url) {
    saveStoredConfig(io, { url: resolveApiUrl(io, parsed.flags.url) });
  }
  const tokenFlag = parsed.flags.token?.trim() || parsed.flags.apiKey?.trim();
  if (tokenFlag) {
    try {
      await new ControlPlaneClient({ url: client.url }).verifyApiToken(tokenFlag);
    } catch (error) {
      if (error instanceof CliError && error.status === 401) {
        throw error;
      }
    }
    saveStoredCredentials(io, { token: tokenFlag });
    writeLine(io.out, `saved token for ${client.url}`);
    return EXIT_OK;
  }

  let email = parsed.flags.email?.trim() ?? "";
  let password = parsed.flags.password ?? io.env.NEO_PASSWORD ?? "";
  if (!email && io.isStdinTty) {
    email = await question(io, "Email: ");
  }
  if (!password && io.isStdinTty) {
    password = await readHidden(io, "Password: ");
  }
  if (!email || !password) {
    throw new CliError("login needs --token, or --email and --password", EXIT_USAGE);
  }
  const session = await client.loginAccount(email, password);
  saveStoredCredentials(io, { token: session.token });
  if (parsed.flags.url) {
    saveStoredConfig(io, { url: client.url });
  }
  writeLine(io.out, `logged in as ${session.user.email}`);
  return EXIT_OK;
}

export async function logoutCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const token = resolveApiToken(io, parsed.flags.apiKey);
  if (token?.startsWith("neo_sess_")) {
    try {
      await createClient(io, parsed.flags).logout();
    } catch {
      // still drop local credentials
    }
  }
  clearStoredCredentials(io);
  writeLine(io.out, "logged out");
  return EXIT_OK;
}

export async function whoamiCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const client = createClient(io, parsed.flags);
  const health = await client.health();
  let me: unknown = null;
  try {
    me = await client.me();
  } catch (error) {
    if (!(error instanceof CliError) || error.status !== 401) {
      throw error;
    }
  }
  printJsonOrText(io, parsed.flags.output, {
    url: client.url,
    health: {
      ok: health.ok,
      workerRuntime: health.workerRuntime,
      llmConfigured: health.llmConfigured,
      authRequired: health.authRequired,
    },
    me,
  });
  return EXIT_OK;
}

export async function healthCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const client = createClient(io, parsed.flags);
  printJsonOrText(io, parsed.flags.output, await client.health());
  return EXIT_OK;
}

export async function runCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const client = createClient(io, parsed.flags);
  const prompt = await resolvePrompt(parsed.args, io);
  if (!prompt) {
    throw new CliError("prompt is required", EXIT_USAGE);
  }
  const repoUrls = await resolveRepoUrls(client, parsed.flags, io.cwd);
  const startedAt = io.now();
  const run = await client.createRun({
    prompt,
    repoUrls,
    source: "cli",
    envId: parsed.flags.envId,
    buildId: parsed.flags.buildId,
    model: parsed.flags.model,
    ref: parsed.flags.ref,
    reuseBuild: parsed.flags.reuseBuild,
  });
  if (parsed.flags.detach) {
    const formatter = createFormatter(parsed.flags.output, io);
    formatter.init(run);
    return formatter.finish(
      resultFrom({
        subtype: "detached",
        run,
        durationMs: Math.max(0, io.now() - startedAt),
        result: run.id,
        eventCount: 0,
      }),
    );
  }
  return waitForTurn(client, run, parsed.flags, io, startedAt);
}

export async function followCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const client = createClient(io, parsed.flags);
  const runId = requireArg(parsed.args, "run id");
  const text = await resolvePrompt(parsed.args.slice(1), io);
  if (!text) {
    throw new CliError("follow-up text is required", EXIT_USAGE);
  }
  const startedAt = io.now();
  const before = await client.transcript(runId);
  await client.followUp(runId, { text, delivery: parsed.flags.delivery });
  if (parsed.flags.detach) {
    writeLine(io.out, runId);
    return EXIT_OK;
  }
  const run = await client.getRun(runId);
  return waitForTurn(
    client,
    run,
    parsed.flags,
    io,
    startedAt,
    [],
    before.events?.at(-1)?.id ?? before.snapshot.lastEventId ?? undefined,
  );
}

export async function resumeCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const client = createClient(io, parsed.flags);
  const runId = requireArg(parsed.args, "run id");
  return replayAndMaybeWait(client, runId, parsed.flags, io, io.now(), !parsed.flags.detach);
}

export async function lsCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const { runs } = await createClient(io, parsed.flags).listRuns();
  if (parsed.flags.output !== "text") {
    printJsonOrText(io, parsed.flags.output, { runs });
    return EXIT_OK;
  }
  if (runs.length === 0) {
    writeLine(io.out, "no runs");
    return EXIT_OK;
  }
  for (const run of runs) {
    const preview = run.prompt.replace(/\s+/g, " ").slice(0, 60);
    writeLine(io.out, `${run.id}\t${run.status}\t${run.model}\t${preview}`);
  }
  return EXIT_OK;
}

export async function getCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const run = await createClient(io, parsed.flags).getRun(requireArg(parsed.args, "run id"));
  printJsonOrText(io, parsed.flags.output, run);
  return EXIT_OK;
}

export async function logCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const runId = requireArg(parsed.args, "run id");
  return replayAndMaybeWait(createClient(io, parsed.flags), runId, parsed.flags, io, io.now(), parsed.flags.follow);
}

export async function abortCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const run = await createClient(io, parsed.flags).abort(requireArg(parsed.args, "run id"));
  printJsonOrText(io, parsed.flags.output, run);
  return EXIT_OK;
}

export async function archiveCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const run = await createClient(io, parsed.flags).archive(requireArg(parsed.args, "run id"));
  printJsonOrText(io, parsed.flags.output, run);
  return EXIT_OK;
}

export async function diffCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  printJsonOrText(io, parsed.flags.output, await createClient(io, parsed.flags).diff(requireArg(parsed.args, "run id")));
  return EXIT_OK;
}

export async function diagCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  printJsonOrText(
    io,
    parsed.flags.output,
    await createClient(io, parsed.flags).diagnostics(requireArg(parsed.args, "run id")),
  );
  return EXIT_OK;
}

export async function prCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const runId = requireArg(parsed.args, "run id");
  const title = parsed.flags.title || parsed.args.slice(1).join(" ").trim() || "Draft PR";
  printJsonOrText(io, parsed.flags.output, await createClient(io, parsed.flags).openPr(runId, title, parsed.flags.body));
  return EXIT_OK;
}

export async function commitCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const runId = requireArg(parsed.args, "run id");
  const message = parsed.flags.message ?? parsed.args.slice(1).join(" ").trim();
  if (!message) {
    throw new CliError("commit message is required (-m)", EXIT_USAGE);
  }
  printJsonOrText(io, parsed.flags.output, await createClient(io, parsed.flags).commit(runId, message));
  return EXIT_OK;
}

export async function envCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const sub = parsed.args[0] ?? "ls";
  if (sub !== "ls") {
    throw new CliError(`unknown env command: ${sub}`, EXIT_USAGE);
  }
  printJsonOrText(io, parsed.flags.output, await createClient(io, parsed.flags).listEnvironments());
  return EXIT_OK;
}

export async function buildCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  const sub = parsed.args[0] ?? "ls";
  if (sub !== "ls") {
    throw new CliError(`unknown build command: ${sub}`, EXIT_USAGE);
  }
  printJsonOrText(io, parsed.flags.output, await createClient(io, parsed.flags).listBuilds());
  return EXIT_OK;
}

export async function vmsCommand(parsed: ParsedCli, io: CliIo): Promise<number> {
  printJsonOrText(io, parsed.flags.output, await createClient(io, parsed.flags).vms());
  return EXIT_OK;
}
