export class DependencyNotConfiguredError extends Error {
	readonly dependency: string;

	constructor(dependency: string) {
		super(`Dependency is not configured: ${dependency}`);
		this.name = "DependencyNotConfiguredError";
		this.dependency = dependency;
	}
}
