import z from "zod"

const PairCodePayload = z.object({
  v: z.literal(1),
  url: z.string().url(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  expiresAt: z.number().int().positive().optional(),
})

export type PairCodePayload = z.infer<typeof PairCodePayload>

export namespace PairingCode {
  export function encode(input: Omit<PairCodePayload, "v">): string {
    return Buffer.from(
      JSON.stringify({
        v: 1,
        ...input,
      }),
      "utf8",
    ).toString("base64url")
  }

  export function decode(code: string): PairCodePayload {
    let decoded: string
    try {
      decoded = Buffer.from(code, "base64url").toString("utf8")
    } catch {
      throw new Error("Invalid pairing code encoding")
    }

    let payload: unknown
    try {
      payload = JSON.parse(decoded)
    } catch {
      throw new Error("Invalid pairing code payload")
    }

    const parsed = PairCodePayload.safeParse(payload)
    if (!parsed.success) {
      throw new Error("Invalid pairing code")
    }
    return parsed.data
  }

  export function isExpired(payload: PairCodePayload, now = Date.now()) {
    return payload.expiresAt !== undefined && payload.expiresAt <= now
  }
}
