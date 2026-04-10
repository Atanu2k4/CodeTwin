import { describe, expect, test } from "bun:test"
import { PairingCode } from "../../src/pairing/code"

describe("pairing.code", () => {
  test("encodes and decodes pairing payload", () => {
    const expiresAt = Date.now() + 60_000
    const encoded = PairingCode.encode({
      url: "http://localhost:4096",
      username: "codetwin",
      password: "secret",
      expiresAt,
    })

    const decoded = PairingCode.decode(encoded)
    expect(decoded.url).toBe("http://localhost:4096")
    expect(decoded.username).toBe("codetwin")
    expect(decoded.password).toBe("secret")
    expect(decoded.expiresAt).toBe(expiresAt)
  })

  test("detects expired payload", () => {
    const payload = PairingCode.decode(
      PairingCode.encode({
        url: "http://localhost:4096",
        expiresAt: Date.now() - 1,
      }),
    )

    expect(PairingCode.isExpired(payload)).toBe(true)
  })
})
