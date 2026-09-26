import { vi } from "vitest";

// A Proxy-backed stand-in for the Prisma client: any `mockPrisma.model.method`
// access lazily becomes a vi.fn() the first time it's touched, so tests don't
// need to hand-declare every method on every model up front. $transaction
// invokes its callback with the *same proxy* (not the raw target), mirroring
// how Prisma passes a `tx` client scoped to the interactive transaction —
// `tx.model.method` and `mockPrisma.model.method` are the same vi.fn().
export function createMockPrisma() {
  const models = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();

  const modelProxy = (modelName: string) =>
    new Proxy(
      {},
      {
        get(_target, methodName: string) {
          if (!models.has(modelName)) models.set(modelName, {});
          const methods = models.get(modelName)!;
          if (!(methodName in methods)) methods[methodName] = vi.fn();
          return methods[methodName];
        },
      }
    );

  const target: Record<string, unknown> = {};

  const proxy = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "$transaction") {
        if (!("$transaction" in target)) {
          target.$transaction = vi.fn(async (arg: unknown) => {
            if (typeof arg === "function") return arg(proxy);
            return Promise.all(arg as Promise<unknown>[]);
          });
        }
        return target.$transaction;
      }
      // Other client-level methods ($queryRaw, $executeRaw, …) are plain
      // functions on the client, not model delegates.
      if (prop.startsWith("$")) {
        if (!(prop in target)) target[prop] = vi.fn();
        return target[prop];
      }
      return modelProxy(prop);
    },
  });

  return proxy as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
    $transaction: ReturnType<typeof vi.fn>;
  };
}
