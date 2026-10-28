import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/client/validators/cf-worker";
import { Validator } from "@cfworker/json-schema";
import { z } from "zod";
import {
  RESOURCE,
  IntegrationError,
  digest,
  remote,
  type IntegrationEnv,
} from "./base";
export type Tool = {
  name: string;
  inputSchema: Record<string, any>;
  outputSchema?: Record<string, any>;
};
export interface Gateway {
  tools: Tool[];
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
export async function openMcp(
  e: IntegrationEnv,
  accessToken: string,
): Promise<Gateway> {
  const client = new Client(
    { name: "endurance-os", version: "0.2.0" },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      listMaxPages: 10,
    },
  );
  const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
    requestInit: {
      headers: { Authorization: "Bearer " + accessToken },
      redirect: "error",
    },
    fetch: ((url: any, init: any) =>
      remote(e, String(url), init)) as typeof fetch,
    reconnectionOptions: {
      maxRetries: 0,
      maxReconnectionDelay: 1000,
      initialReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    await e.DB.prepare(
      "UPDATE integration_connections SET tools_json=? WHERE id='athledata'",
    )
      .bind(JSON.stringify(tools))
      .run();
    return {
      tools: tools as Tool[],
      call: async (name, args) => {
        const r = await client.callTool(
          { name, arguments: args },
          { timeout: 15000 },
        );
        if (r.isError) throw new IntegrationError("MCP_TOOL_ERROR", 502);
        if (r.structuredContent) return r.structuredContent;
        const texts = r.content.filter((x: any) => x.type === "text") as {
          text: string;
        }[];
        if (texts.length !== 1)
          throw new IntegrationError("UNVERIFIED_TOOL_RESULT", 502);
        try {
          return JSON.parse(texts[0].text);
        } catch {
          throw new IntegrationError("UNVERIFIED_TOOL_RESULT", 502);
        }
      },
      close: () => client.close(),
    };
  } catch (err) {
    await client.close();
    throw err;
  }
}
const contractSchema = z
  .object({
    schemaHash: z.string().length(64),
    args: z.record(z.string(), z.string()),
    resultIdPath: z.string().optional(),
    itemsPath: z.string().optional(),
    cursorPath: z.string().optional(),
    fields: z.record(z.string(), z.string()).optional(),
    originNamespace: z.string().optional(),
  })
  .strict();
export type Contract = z.infer<typeof contractSchema>;
export async function contract(
  e: IntegrationEnv,
  tools: Tool[],
  name: string,
): Promise<{ tool: Tool; profile: Contract }> {
  const profiles = JSON.parse(e.ATHLEDATA_CONTRACTS_JSON || "{}");
  if (!profiles[name])
    throw new IntegrationError("PROVIDER_CONTRACT_REVIEW_REQUIRED");
  const profile = contractSchema.parse(profiles[name]),
    tool = tools.find((t) => t.name === name);
  if (
    !tool ||
    (await digest(
      JSON.stringify({
        input: tool.inputSchema,
        output: tool.outputSchema ?? null,
      }),
    )) !== profile.schemaHash
  )
    throw new IntegrationError("PROVIDER_SCHEMA_CHANGED");
  return { tool, profile };
}
export function at(value: any, path: string): any {
  if (!path) return value;
  return path.split(".").reduce((obj, k) => {
    if (["__proto__", "constructor", "prototype"].includes(k))
      throw new IntegrationError("INVALID_MAPPING");
    return obj?.[k];
  }, value);
}
export function argumentsFor(
  tool: Tool,
  profile: Contract,
  context: Record<string, unknown>,
) {
  const args: Record<string, unknown> = {};
  for (const [key, path] of Object.entries(profile.args)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new IntegrationError("INVALID_MAPPING");
    const value = at(context, path);
    if (value !== undefined) args[key] = value;
  }
  if (!new Validator(tool.inputSchema, "2020-12", true).validate(args).valid)
    throw new IntegrationError("UNSUPPORTED_WORKOUT_TRANSLATION");
  return args;
}
export function returnedId(profile: Contract, result: unknown) {
  if (!profile.resultIdPath)
    throw new IntegrationError("RESULT_ID_MAPPING_REQUIRED");
  const value = at(result, profile.resultIdPath);
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" &&
      (!Number.isSafeInteger(value) || value < 0)) ||
    String(value).length === 0
  )
    throw new IntegrationError("RESULT_ID_MISSING");
  return String(value);
}
// These are the requested candidate names, never claims that the live account exposes them.
export const writeTools = {
  create: "push_workout_to_watch",
  update: "update_workout_on_watch",
  delete: "delete_workout_from_watch",
} as const;
