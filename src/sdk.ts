import { DjsConnect } from "@unitn-asa/deliveroo-js-sdk";
import type { IOAgent } from "@unitn-asa/deliveroo-js-sdk/types/IOAgent.js";
import type { IOTile } from "@unitn-asa/deliveroo-js-sdk/types/IOTile.js";

export type { IOAgent, IOTile };

export type Socket = ReturnType<typeof DjsConnect>;

export type Direction = Parameters<Socket["emitMove"]>[0];

export interface World {
  me: IOAgent;
  tiles: IOTile[];
}

// DjsConnect defaults every argument to HOST / TOKEN / NAME in the environment.
export function connect(): Socket {
  return DjsConnect();
}

export async function ready(socket: Socket): Promise<World> {
  const [me, tiles] = await Promise.all([
    new Promise<IOAgent>((resolve) => socket.onceYou(resolve)),
    new Promise<IOTile[]>((resolve) =>
      socket.onMap((_width, _height, tiles) => resolve(tiles)),
    ),
  ]);
  return { me, tiles };
}
