import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("app factory", () => {
  it("answers /api/health via inject() without listening on a port", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });
});
