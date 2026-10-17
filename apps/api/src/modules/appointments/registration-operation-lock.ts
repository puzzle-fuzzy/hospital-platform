import { DependencyNotConfiguredError } from "@hospital/domain";

export type RegistrationOperationReference = {
	ownerUserId: string;
	appointmentId: string;
};

export type RegistrationOperationLock = <R>(
	ownerUserId: string,
	appointmentId: string,
	operation: () => Promise<R>,
) => Promise<R>;

/**
 * Serialize explicit registration commands with administrator cancellation.
 * The resolver must derive references from server-owned records. Reentrancy is
 * owned by the repository lock, never by request flags or Provider parameters.
 */
export function guardRegistrationOperations<T extends object>(
	service: T,
	methodNames: readonly (keyof T)[],
	resolve: (
		input: unknown,
	) => Promise<RegistrationOperationReference | undefined>,
	withLock?: RegistrationOperationLock,
): T {
	const guarded = new Set<PropertyKey>(methodNames);
	const methods = new Map<PropertyKey, { original: unknown; bound: unknown }>();
	return new Proxy(service, {
		get(target, property) {
			// Class private fields and getters must observe their actual instance.
			const original = Reflect.get(target, property, target);
			if (typeof original !== "function" || property === "constructor")
				return original;
			const cached = methods.get(property);
			if (cached?.original === original) return cached.bound;
			const bound = guarded.has(property)
				? async (...args: unknown[]) => {
						const reference = await resolve(args[0]);
						const invoke = async () => Reflect.apply(original, target, args);
						if (!reference) return invoke();
						if (!withLock)
							throw new DependencyNotConfiguredError(
								"appointment-operation-lock",
							);
						return withLock(
							reference.ownerUserId,
							reference.appointmentId,
							invoke,
						);
					}
				: original.bind(target);
			methods.set(property, { original, bound });
			return bound;
		},
	});
}
