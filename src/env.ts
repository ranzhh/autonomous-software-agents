import { cleanEnv, str, url } from "envalid";

export const env = cleanEnv(process.env, {
  HOST: url({ default: "http://localhost:8080" }),
  NAME: str({ testDefault: "test" }),
  TEAM: str({ testDefault: "test" }),
  TOKEN: str({ default: undefined }),
  FAST_DOWNWARD: str({ default: "fast-downward" }),
  TEAM_SECRET: str({ default: undefined }),
  LLM_URL: url({ default: undefined }),
  LLM_MODEL: str({ default: "llama3.1:8b" }),
  LLM_KEY: str({ default: "none" }),
  ADMIN_TOKEN: str({ default: undefined }),
  /** Seeds every random draw the agent makes; unset means Math.random. */
  SEED: str({ default: undefined }),
  LOG_LEVEL: str({
    choices: ["fatal", "error", "warn", "info", "debug", "trace", "silent"],
    default: "info",
  }),
});
