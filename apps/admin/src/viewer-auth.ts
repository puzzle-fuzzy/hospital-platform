import { randomBytes } from "node:crypto";

const tokenPrefix = "admin-viewer.";
const sessionTtlMs = 30 * 60 * 1_000;
const maxSessions = 500;

export class AdminViewerAuthError extends Error {
	constructor(
		message: string,
		readonly status: 401 | 403 | 503,
	) {
		super(message);
	}
}

type ViewerPrincipal = {
	kind: "viewer";
	readOnly: true;
	expiresAt: number;
};

export type AdminViewerAudit = {
	event:
		| "admin.viewer.login.succeeded"
		| "admin.viewer.login.rejected"
		| "admin.viewer.session.expired"
		| "admin.viewer.access.denied"
		| "admin.viewer.read"
		| "admin.viewer.logout";
	actor: "admin-viewer";
	method: string;
	resource: string;
};

function auditResource(pathname: string): string {
	if (pathname === "/api/auth/logout") return "auth.logout";
	if (pathname === "/api/refunds/wechat/payments") return "payments.list";
	if (pathname.startsWith("/api/refunds/payment-operations/"))
		return "payments.ledger";
	if (pathname === "/api/refunds/payment-sync-tasks")
		return "payments.sync-tasks";
	if (pathname === "/api/payments/day") return "payments.day";
	if (pathname === "/api/logs") return "logs.list";
	if (/^\/api\/logs\/log-[1-9][0-9]*$/u.test(pathname)) return "logs.detail";
	return "restricted";
}

export function isAdminViewerAuthorization(authorization: string): boolean {
	return /^Bearer admin-viewer\./iu.test(authorization.trim());
}

/** Financial read routes only. Derived ledger refresh/audit writes are allowed;
 * provider status refresh and financial commands are deliberately excluded. */
export function isAdminViewerReadRoute(
	method: string,
	pathname: string,
): boolean {
	if (method !== "GET") return false;
	return (
		[
			"/api/refunds/wechat/payments",
			"/api/refunds/payment-sync-tasks",
			"/api/payments/day",
			"/api/logs",
		].includes(pathname) ||
		/^\/api\/refunds\/payment-operations\/payagg-[a-f0-9]{56}$/u.test(
			pathname,
		) ||
		/^\/api\/logs\/log-[1-9][0-9]{0,27}$/u.test(pathname)
	);
}

export function createAdminViewerAuth(options: {
	username?: string;
	passwordHash?: string;
	now?: () => number;
	verify?: (password: string, hash: string) => Promise<boolean>;
	createToken?: () => string;
	onAudit?: (event: AdminViewerAudit) => void;
}) {
	const username = options.username?.trim() || "";
	const passwordHash = options.passwordHash?.trim() || "";
	const now = options.now ?? Date.now;
	const verify =
		options.verify ?? ((password, hash) => Bun.password.verify(password, hash));
	const createToken =
		options.createToken ?? (() => randomBytes(32).toString("base64url"));
	const sessions = new Map<string, ViewerPrincipal>();
	function audit(
		event: AdminViewerAudit["event"],
		method: string,
		resource: string,
	) {
		options.onAudit?.({
			event,
			actor: "admin-viewer",
			method: [
				"GET",
				"POST",
				"PUT",
				"PATCH",
				"DELETE",
				"HEAD",
				"OPTIONS",
			].includes(method)
				? method
				: "OTHER",
			resource,
		});
	}
	const configured = Boolean(
		username &&
			username.length <= 64 &&
			!Array.from(username).some(
				(character) =>
					character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f,
			) &&
			/^\$argon2id\$[^\r\n]{1,500}$/u.test(passwordHash),
	);

	function principal(request: Request): ViewerPrincipal | undefined {
		const authorization = request.headers.get("authorization") || "";
		if (!isAdminViewerAuthorization(authorization)) return undefined;
		const token = authorization.trim().slice("Bearer ".length);
		const session = sessions.get(token);
		if (!session || session.expiresAt <= now()) {
			sessions.delete(token);
			audit(
				"admin.viewer.session.expired",
				request.method,
				auditResource(new URL(request.url).pathname),
			);
			throw new AdminViewerAuthError("只读会话已失效，请重新登录", 401);
		}
		return session;
	}

	return {
		async login(input: {
			username: string;
			password: unknown;
			loginMode?: unknown;
		}) {
			if (
				input.loginMode !== undefined &&
				input.loginMode !== "operator" &&
				input.loginMode !== "viewer"
			) {
				audit("admin.viewer.login.rejected", "POST", "auth.login");
				throw new AdminViewerAuthError("登录方式不合法", 401);
			}
			const matchesViewer =
				Boolean(username) &&
				input.username.toLowerCase() === username.toLowerCase();
			if (input.loginMode !== "viewer" && !matchesViewer) return undefined;
			if (!configured) {
				audit("admin.viewer.login.rejected", "POST", "auth.login");
				throw new AdminViewerAuthError("只读账号尚未配置", 503);
			}
			if (
				!matchesViewer ||
				typeof input.password !== "string" ||
				!input.password ||
				input.password.length > 256
			) {
				audit("admin.viewer.login.rejected", "POST", "auth.login");
				throw new AdminViewerAuthError("只读账号或密码错误", 401);
			}
			let valid = false;
			try {
				valid = await verify(input.password, passwordHash);
			} catch {
				/* Invalid hashes fail closed. */
			}
			if (!valid) {
				audit("admin.viewer.login.rejected", "POST", "auth.login");
				throw new AdminViewerAuthError("只读账号或密码错误", 401);
			}
			for (const [token, session] of sessions) {
				if (session.expiresAt <= now()) sessions.delete(token);
			}
			const token = `${tokenPrefix}${createToken()}`;
			sessions.set(token, {
				kind: "viewer",
				readOnly: true,
				expiresAt: now() + sessionTtlMs,
			});
			while (sessions.size > maxSessions) {
				const oldest = sessions.keys().next().value;
				if (oldest) sessions.delete(oldest);
			}
			audit("admin.viewer.login.succeeded", "POST", "auth.login");
			return {
				access_token: token,
				refresh_token: "",
				token_type: "Bearer",
				expires_in: sessionTtlMs / 1_000,
				capabilities: { readOnly: true },
			};
		},
		principal,
		authorize(request: Request): void {
			if (!principal(request)) return;
			const pathname = new URL(request.url).pathname;
			if (request.method === "POST" && pathname === "/api/auth/logout") return;
			if (!isAdminViewerReadRoute(request.method, pathname)) {
				audit(
					"admin.viewer.access.denied",
					request.method,
					auditResource(pathname),
				);
				throw new AdminViewerAuthError("只读账号不能执行此操作", 403);
			}
			audit("admin.viewer.read", request.method, auditResource(pathname));
		},
		logout(request: Request): boolean {
			if (!principal(request)) return false;
			sessions.delete(
				(request.headers.get("authorization") || "")
					.trim()
					.slice("Bearer ".length),
			);
			audit("admin.viewer.logout", "POST", "auth.logout");
			return true;
		},
	};
}
