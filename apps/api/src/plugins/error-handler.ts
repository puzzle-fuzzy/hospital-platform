import { Elysia } from "elysia";
import { DependencyNotConfiguredError } from "@hospital/domain";
import { HttpError } from "../errors";

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
	return new Elysia({ name: "error-handler" }).onError(
		{ as: "global" },
		({ code, error, set }) => {
			if (error instanceof HttpError) {
				set.status = error.statusCode;
				return {
					success: false,
					error: { code: error.code, message: error.message },
				};
			}

			if (error instanceof DependencyNotConfiguredError) {
				set.status = 503;
				return {
					success: false,
					error: {
						code: "dependency-not-configured",
						message: "Required service dependency is not configured",
					},
				};
			}

			const normalizedCode = normalizeCode(code);
			set.status = statusFor(normalizedCode);
			return {
				success: false,
				error: {
					code: errorCode(normalizedCode),
					message: messageFor(normalizedCode),
				},
			};
		},
	);
}
