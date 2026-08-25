import { cleanEnv, str, url } from "envalid";

export const env = cleanEnv(process.env, {
  HOST: url({ default: "http://localhost:8080" }),
  NAME: str({ testDefault: "test" }),
  TEAM: str({ testDefault: "test" }),
  TOKEN: str({ default: undefined }),
  ADMIN_TOKEN: str({ default: undefined }),
  LOG_LEVEL: str({
    choices: ["fatal", "error", "warn", "info", "debug", "trace", "silent"],
    default: "info",
  }),
});
