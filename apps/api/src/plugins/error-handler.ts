import { Elysia } from "elysia";

function normalizeCode(code: string | number): string {
	return typeof code === "string" ? code : "UNKNOWN";
}

function errorCode(code: string): string {
	return code.toLowerCase().replaceAll("_", "-");
}

function statusFor(code: string): number {
	if (code === "NOT_FOUND") return 404;
	if (code === "VALIDATION" || code === "PARSE") return 400;
	return 500;
}

function messageFor(code: string): string {
	if (code === "NOT_FOUND") return "Route not found";
	if (code === "VALIDATION") return "Request validation failed";
	if (code === "PARSE") return "Request body could not be parsed";
	return "Internal Server Error";
}

export function errorHandlerPlugin() {
	return new Elysia({ name: "error-handler" }).onError(({ code, set }) => {
		const normalizedCode = normalizeCode(code);
		set.status = statusFor(normalizedCode);
		return {
			success: false,
			error: {
				code: errorCode(normalizedCode),
				message: messageFor(normalizedCode),
			},
		};
	});
}
