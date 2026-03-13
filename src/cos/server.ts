import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";

export interface ChiefOfStaffServer {
  server: ServerType;
  endpoint: string;
  close(): Promise<void>;
}

export function createChiefOfStaffApp(registry: { handler(request: Request): Promise<Response> | Response }) {
  const app = new Hono();
  app.get("/health", (c) => c.text("OK"));
  app.all("/api/rivet/*", (c) => registry.handler(c.req.raw));
  return app;
}

export async function startChiefOfStaffServer(options: {
  registry: { handler(request: Request): Promise<Response> | Response };
  port: number;
  host?: string;
}): Promise<ChiefOfStaffServer> {
  const app = createChiefOfStaffApp(options.registry);
  const server = serve({
    fetch: app.fetch,
    port: options.port,
    hostname: options.host ?? "127.0.0.1",
  });
  const endpoint = `http://${options.host ?? "127.0.0.1"}:${options.port}/api/rivet`;
  return {
    server,
    endpoint,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
