export type RuntimeConfig = {
	host: string;
	port: number;
	apiVersion: string;
	docsEnabled: boolean;
};

function positivePort(value: string | undefined): number {
	const port = Number(value ?? 3000);
	return Number.isInteger(port) && port > 0 && port < 65_536 ? port : 3000;
}

export const config: RuntimeConfig = {
	host: Bun.env.HOST ?? "127.0.0.1",
	port: positivePort(Bun.env.PORT),
	apiVersion: Bun.env.API_VERSION ?? "0.1.0",
	docsEnabled: Bun.env.DOCS_ENABLED !== "false",
};
