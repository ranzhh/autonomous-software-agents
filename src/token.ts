import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { env } from "./env.js";

const DIR = ".run/tokens";

const [agent, ...flags] = process.argv.slice(2);
if (!agent) throw new Error("usage: token.ts <agent> [--new]");

const path = `${DIR}/${agent}.jwt`;

if (!flags.includes("--new") && existsSync(path)) {
  console.log(readFileSync(path, "utf8").trim());
} else {
  // The server mints a fresh id and teamId per call; name and team are only labels.
  const response = await fetch(`${env.HOST}/api/tokens`, {
    method: "POST",
    headers: { name: `${env.NAME}-${agent}`, team: env.TEAM },
  });
  if (!response.ok)
    throw new Error(`minting a token failed: ${response.status}`);

  const { token } = (await response.json()) as { token: string };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  console.log(token);
}
