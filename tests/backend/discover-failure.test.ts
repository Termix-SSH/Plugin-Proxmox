import { describe, expect, it } from "vitest";
import { discoverFailure } from "../../src/backend/routes.js";

function named(name: string, message: string) {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("discoverFailure", () => {
  it("answers a host the user can't reach with 404", () => {
    expect(
      discoverFailure(
        named("SshHostNotFoundError", "Host not found or access denied"),
      ),
    ).toEqual({ status: 404, body: { error: "Host not found" } });
  });

  it("keeps the reason for problems the user can fix", () => {
    const failure = discoverFailure(new Error("Authentication failed"));
    expect(failure.status).toBe(422);
    expect(failure.body.error).toBe("Discovery failed: Authentication failed");
  });

  it("never sends the text of a server fault", () => {
    const failure = discoverFailure(
      new Error("SQLITE_CONSTRAINT: FOREIGN KEY constraint failed"),
    );
    expect(failure.status).toBe(500);
    expect(failure.body.error).toBe("Discovery failed");
  });
});
