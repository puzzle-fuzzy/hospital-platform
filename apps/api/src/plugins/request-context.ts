import { Elysia } from "elysia";

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

function requestIdFrom(request: Request): string {
	const incoming = request.headers.get("x-request-id")?.trim();
	return incoming && requestIdPattern.test(incoming)
		? incoming
		: crypto.randomUUID();
}

export function requestContextPlugin() {
	return new Elysia({ name: "request-context" }).onRequest(
		({ request, set }) => {
			set.headers["x-request-id"] = requestIdFrom(request);
		},
	);
}
