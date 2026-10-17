import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";

export const ONLINE_API_SHA256 =
	"90d096bf5bc6aedfa42b823be509511e1e465ba09ad2fb2b62241e6faf358377";
export const PATCH_MODULES = [
	"packages/adapters/src/legacy-fsi-medical-insurance.ts",
	"packages/adapters/src/zhongyang-outpatient-payments.ts",
	"packages/domain/src/outpatient-payments.ts",
	"packages/contracts/src/index.ts",
	"src/modules/medical-insurance/payment-presentation.ts",
	"src/modules/medical-insurance/payment-core.ts",
	"src/modules/medical-insurance/registration-service.ts",
	"src/modules/medical-insurance/wechat-payment-service.ts",
];
export const sha256 = (value) =>
	createHash("sha256").update(value).digest("hex");
const invariant = (condition, message) => {
	if (!condition) throw new Error(message);
};
const baseName = (name) =>
	name.replace(/^paymentParsingDiscount_/, "").replace(/\d+$/, "");
const moduleName = (name) => {
	const relative = name.replace(/^(?:\.\.\/)+/, "");
	return (
		relative.includes("node_modules/")
			? relative.slice(relative.indexOf("node_modules/"))
			: relative
	).replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//, "node_modules/");
};

/** This one-off operator tool uses an explicitly supplied TypeScript 5 AST API.
 * The application's TypeScript 7 compiler has no compatible JS AST API. */
export function loadTypeScript(path = process.env.PAYMENT_RUNTIME_TYPESCRIPT) {
	invariant(
		path,
		"Set PAYMENT_RUNTIME_TYPESCRIPT to a verified TypeScript 5.9.3 lib/typescript.js",
	);
	const ts = createRequire(import.meta.url)(resolve(path));
	invariant(
		ts.version === "5.9.3" && typeof ts.createProgram === "function",
		"Expected TypeScript AST API 5.9.3",
	);
	return ts;
}

function bundleModel(text, ts) {
	const filename = "/__payment_runtime__.js";
	const source = ts.createSourceFile(
		filename,
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	invariant(
		source.parseDiagnostics.length === 0,
		"Bundle has JavaScript syntax errors",
	);
	const host = ts.createCompilerHost({
		allowJs: true,
		noLib: true,
		noResolve: true,
	});
	host.getSourceFile = (file) => (file === filename ? source : undefined);
	host.fileExists = (file) => file === filename;
	host.readFile = (file) => (file === filename ? text : undefined);
	const program = ts.createProgram(
		[filename],
		{ allowJs: true, noLib: true, noResolve: true },
		host,
	);
	const checker = program.getTypeChecker();
	const markers = [...text.matchAll(/^\/\/ (.+)$/gm)].map((match) => ({
		name: moduleName(match[1]),
		start: match.index,
		end: match.index + match[0].length + 1,
	}));
	const at = (position) => {
		let low = 0;
		let high = markers.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (markers[middle].start <= position) low = middle + 1;
			else high = middle;
		}
		return markers[low - 1]?.name ?? "__preamble__";
	};
	const declarations = new Map();
	const symbols = new Map();
	const counters = new Map();
	const modules = new Map();
	const bind = (identifier, key) => {
		const symbol = checker.getSymbolAtLocation(identifier);
		if (symbol) symbols.set(symbol, key);
	};
	for (const statement of source.statements) {
		const owner = at(statement.getStart(source));
		if (!modules.has(owner)) modules.set(owner, []);
		modules.get(owner).push(statement);
		const named = [];
		if (
			(ts.isFunctionDeclaration(statement) ||
				ts.isClassDeclaration(statement)) &&
			statement.name
		)
			named.push(statement.name);
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				const names = (binding) => {
					if (ts.isIdentifier(binding)) named.push(binding);
					else
						for (const element of binding.elements)
							if (ts.isBindingElement(element)) names(element.name);
				};
				names(declaration.name);
			}
		}
		if (ts.isImportDeclaration(statement) && statement.importClause) {
			if (statement.importClause.name) named.push(statement.importClause.name);
			const bindings = statement.importClause.namedBindings;
			if (bindings && ts.isNamedImports(bindings))
				named.push(...bindings.elements.map((element) => element.name));
			else if (bindings) named.push(bindings.name);
		}
		for (const name of named) {
			const stem = `${owner}::${baseName(name.text)}`;
			const occurrence = counters.get(stem) ?? 0;
			counters.set(stem, occurrence + 1);
			const key = `${stem}::${occurrence}`;
			invariant(!declarations.has(key), `Duplicate global key ${key}`);
			declarations.set(key, { name: name.text, statement, owner });
			bind(name, key);
		}
	}
	function property(node) {
		const parent = node.parent;
		return (
			(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
			((ts.isPropertyAssignment(parent) ||
				ts.isPropertyDeclaration(parent) ||
				ts.isMethodDeclaration(parent) ||
				ts.isGetAccessorDeclaration(parent) ||
				ts.isSetAccessorDeclaration(parent)) &&
				parent.name === node) ||
			(ts.isBindingElement(parent) && parent.propertyName === node) ||
			(ts.isImportSpecifier(parent) && parent.propertyName === node)
		);
	}
	// A suffix can differ between Bun builds, but two different declarations
	// named amount and amount2 must never collapse into one binding. Scope and
	// declaration occurrence belong to the canonical identity of a local symbol.
	const localSymbols = new Map();
	for (const statement of source.statements) {
		const rootScope = {
			path: key(statement),
			localCounts: new Map(),
			functionCounts: new Map(),
		};
		const bindLocal = (name, scope) => {
			if (!ts.isIdentifier(name)) return;
			const symbol = checker.getSymbolAtLocation(name);
			if (!symbol || symbols.has(symbol) || localSymbols.has(symbol)) return;
			const stem = baseName(name.text);
			const occurrence = scope.localCounts.get(stem) ?? 0;
			scope.localCounts.set(stem, occurrence + 1);
			localSymbols.set(symbol, `${scope.path}::${stem}::${occurrence}`);
		};
		function visit(node, scope) {
			if (ts.isFunctionLike(node)) {
				if (ts.isFunctionDeclaration(node) && node.name)
					bindLocal(node.name, scope);
				const name = node.name?.getText(source) ?? "anonymous";
				const stem = `${node.kind}:${baseName(name)}`;
				const occurrence = scope.functionCounts.get(stem) ?? 0;
				scope.functionCounts.set(stem, occurrence + 1);
				scope = {
					path: `${scope.path}::scope:${stem}:${occurrence}`,
					localCounts: new Map(),
					functionCounts: new Map(),
				};
			}
			if (
				ts.isVariableDeclaration(node) ||
				ts.isParameter(node) ||
				ts.isBindingElement(node)
			)
				bindLocal(node.name, scope);
			ts.forEachChild(node, (child) => visit(child, scope));
		}
		visit(statement, rootScope);
	}
	function identifier(node, shorthand = false) {
		if (!shorthand && property(node)) return `property:${node.text}`;
		const symbol = shorthand
			? checker.getShorthandAssignmentValueSymbol(node.parent)
			: checker.getSymbolAtLocation(node);
		const global = symbols.get(symbol);
		if (global) return `global:${global}`;
		if (localSymbols.has(symbol)) return `local:${localSymbols.get(symbol)}`;
		invariant(
			!symbol?.declarations?.some(
				(declaration) => declaration.getSourceFile() === source,
			),
			`Unmapped local binding ${node.text}`,
		);
		return `unbound:${node.text}`;
	}
	function canonical(node) {
		if (ts.isShorthandPropertyAssignment(node))
			return [
				ts.SyntaxKind.PropertyAssignment,
				null,
				null,
				[`property:${node.name.text}`],
				[identifier(node.name, true)],
			];
		if (
			ts.isBindingElement(node) &&
			ts.isObjectBindingPattern(node.parent) &&
			ts.isIdentifier(node.name)
		)
			return [
				node.kind,
				node.dotDotDotToken?.kind ?? null,
				[`property:${node.propertyName?.getText(source) ?? node.name.text}`],
				canonical(node.name),
				node.initializer ? canonical(node.initializer) : null,
			];
		if (ts.isIdentifier(node)) return [identifier(node)];
		if (ts.isPrivateIdentifier(node)) return [node.kind, node.text];
		if (
			ts.isStringLiteralLike(node) ||
			ts.isNumericLiteral(node) ||
			ts.isBigIntLiteral(node) ||
			ts.isRegularExpressionLiteral(node) ||
			ts.isTemplateLiteralToken(node)
		)
			return [node.kind, node.text];
		const children = [];
		ts.forEachChild(node, (child) => {
			children.push(canonical(child));
		});
		return [
			node.kind,
			ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)
				? node.operator
				: null,
			ts.isVariableDeclarationList(node)
				? node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)
				: null,
			...children,
		];
	}
	function normalized(node) {
		return JSON.stringify(canonical(node));
	}
	function key(statement) {
		for (const [global, declaration] of declarations)
			if (declaration.statement === statement) return global;
		return `${at(statement.getStart(source))}::statement:${statement.kind}:${statement.getText(source).slice(0, 50)}`;
	}
	return {
		text,
		source,
		checker,
		symbols,
		declarations,
		modules,
		markers,
		at,
		property,
		normalized,
		key,
		ts,
	};
}

function members(model, statement) {
	if (!model.ts.isClassDeclaration(statement)) return undefined;
	const found = new Map();
	for (const member of statement.members) {
		const name =
			member.name?.getText(model.source) ??
			(model.ts.isConstructorDeclaration(member) ? "constructor" : "unknown");
		const key = `${member.kind}:${name}`;
		invariant(!found.has(key), `Duplicate class member ${name}`);
		found.set(key, member);
	}
	return found;
}

/** Transplant only changed functions, class members and schema statements.
 * Every untouched byte is copied from the current live bundle. */
export function createRuntimePatch({
	online,
	baseline,
	candidate,
	expectedOnlineSha256 = ONLINE_API_SHA256,
	typescript,
	allowedModules = PATCH_MODULES,
}) {
	invariant(
		sha256(online) === expectedOnlineSha256,
		"Online API SHA-256 guard failed",
	);
	const ts = typescript ?? loadTypeScript();
	const live = bundleModel(online, ts);
	const old = bundleModel(baseline, ts);
	const next = bundleModel(candidate, ts);
	const allowed = new Set(allowedModules);
	const edits = [];
	const changes = [];
	const rename = new Map();
	const occupied = new Set(
		[...live.declarations.values()].map((entry) => entry.name),
	);
	for (const [key, declaration] of next.declarations) {
		if (live.declarations.has(key))
			rename.set(key, live.declarations.get(key).name);
		else if (allowed.has(declaration.owner)) {
			let name = `paymentParsingDiscount_${declaration.name}`;
			while (occupied.has(name)) name += "_";
			occupied.add(name);
			rename.set(key, name);
		}
	}
	function transplant(node, locals = new Map()) {
		const start = node.getStart(next.source);
		const end = node.end;
		const replacements = [];
		function visit(child) {
			if (ts.isIdentifier(child) && !next.property(child)) {
				const symbol = ts.isShorthandPropertyAssignment(child.parent)
					? next.checker.getShorthandAssignmentValueSymbol(child.parent)
					: next.checker.getSymbolAtLocation(child);
				const key = next.symbols.get(symbol);
				if (key) {
					const name = rename.get(key);
					invariant(name, `Unmapped external binding ${key}`);
					if (name !== child.text)
						replacements.push({
							start: child.getStart(next.source) - start,
							end: child.end - start,
							text: ts.isShorthandPropertyAssignment(child.parent)
								? `${child.text}: ${name}`
								: name,
						});
				} else if (locals.has(symbol) && locals.get(symbol) !== child.text)
					replacements.push({
						start: child.getStart(next.source) - start,
						end: child.end - start,
						text: ts.isShorthandPropertyAssignment(child.parent)
							? `${child.text}: ${locals.get(symbol)}`
							: locals.get(symbol),
					});
			}
			ts.forEachChild(child, visit);
		}
		visit(node);
		let text = candidate.slice(start, end);
		for (const replacement of replacements.sort((a, b) => b.start - a.start))
			text =
				text.slice(0, replacement.start) +
				replacement.text +
				text.slice(replacement.end);
		return text;
	}
	function scopedBindings(model, root) {
		const groups = new Map();
		const add = (name, kind) => {
			if (!ts.isIdentifier(name)) return;
			const symbol = model.checker.getSymbolAtLocation(name);
			if (!symbol || model.symbols.has(symbol)) return;
			const key = `${kind}:${baseName(name.text)}`;
			if (!groups.has(key)) groups.set(key, []);
			if (!groups.get(key).some((item) => item.symbol === symbol))
				groups.get(key).push({ symbol, name: name.text });
		};
		function visit(node) {
			if (node !== root && ts.isFunctionLike(node)) return;
			if (
				ts.isVariableDeclaration(node) ||
				ts.isParameter(node) ||
				ts.isBindingElement(node)
			)
				add(node.name, node.kind);
			ts.forEachChild(node, visit);
		}
		visit(root);
		return groups;
	}
	function addEdit(
		actual,
		previous,
		changed,
		label,
		inheritedLocals = new Map(),
	) {
		if (old.normalized(previous) === next.normalized(changed)) return;
		let locals = inheritedLocals;
		if (ts.isFunctionLike(changed) && ts.isFunctionLike(actual)) {
			locals = new Map(inheritedLocals);
			const liveGroups = scopedBindings(live, actual);
			const nextGroups = scopedBindings(next, changed);
			for (const [key, group] of nextGroups) {
				const matches = liveGroups.get(key);
				if (!matches) continue;
				if (matches.length === group.length)
					group.forEach((entry, index) => {
						locals.set(entry.symbol, matches[index].name);
					});
				else if (new Set(matches.map((entry) => entry.name)).size === 1)
					group.forEach((entry) => {
						locals.set(entry.symbol, matches[0].name);
					});
			}
		}
		const children = (node) => {
			const found = [];
			ts.forEachChild(node, (child) => {
				found.push(child);
			});
			return found;
		};
		const oldChildren = children(previous);
		const liveChildren = children(actual);
		const nextChildren = children(changed);
		if (
			previous.kind === changed.kind &&
			actual.kind === previous.kind &&
			oldChildren.length > 0 &&
			oldChildren.length === nextChildren.length &&
			oldChildren.length === liveChildren.length
		) {
			const before = edits.length;
			for (let index = 0; index < oldChildren.length; index++)
				addEdit(
					liveChildren[index],
					oldChildren[index],
					nextChildren[index],
					`${label}/${index}`,
					locals,
				);
			if (edits.length > before) return;
		}
		const start = actual.getStart(live.source);
		const end = actual.end;
		const text = transplant(changed, locals);
		edits.push({ start, end, text });
		changes.push({
			label,
			start,
			end,
			oldSha256: sha256(online.slice(start, end)),
			newSha256: sha256(text),
		});
	}
	for (const owner of allowed) {
		const oldStatements = old.modules.get(owner) ?? [];
		const nextStatements = next.modules.get(owner) ?? [];
		const liveStatements = live.modules.get(owner) ?? [];
		if (oldStatements.length === 0) {
			invariant(
				liveStatements.length === 0,
				`Unexpected existing new module ${owner}`,
			);
			invariant(nextStatements.length > 0, `Expected new module ${owner}`);
			const text = `\n// ${owner}\n${nextStatements.map((statement) => transplant(statement)).join("\n")}\n`;
			// Function declarations may safely appear before existing modules and are
			// only invoked after API initialization. No financial actions execute here.
			invariant(
				nextStatements.every(ts.isFunctionDeclaration),
				`New module ${owner} may only add functions`,
			);
			edits.push({ start: 0, end: 0, text });
			changes.push({
				label: `${owner}:new-functions`,
				start: 0,
				end: 0,
				oldSha256: sha256(""),
				newSha256: sha256(text),
			});
			continue;
		}
		const oldByKey = new Map(
			oldStatements.map((statement) => [old.key(statement), statement]),
		);
		const liveByKey = new Map(
			liveStatements.map((statement) => [live.key(statement), statement]),
		);
		invariant(
			oldByKey.size === liveByKey.size,
			`Live module declaration count differs from source baseline: ${owner}`,
		);
		for (const [key, statement] of oldByKey) {
			const actual = liveByKey.get(key);
			invariant(actual, `Live declaration missing: ${key}`);
			const expectedAst = old.normalized(statement);
			const actualAst = live.normalized(actual);
			if (expectedAst !== actualAst) {
				let offset = 0;
				while (
					expectedAst[offset] === actualAst[offset] &&
					offset < expectedAst.length
				)
					offset++;
				throw new Error(
					`Live target differs semantically from source baseline: ${key}; AST ${expectedAst.slice(Math.max(0, offset - 50), offset + 100)} != ${actualAst.slice(Math.max(0, offset - 50), offset + 100)}`,
				);
			}
		}
		for (const statement of nextStatements) {
			const key = next.key(statement);
			const previous = oldByKey.get(key);
			const actual = liveByKey.get(key);
			if (!previous) {
				invariant(
					ts.isFunctionDeclaration(statement),
					`Only new helper functions may be added in ${owner}`,
				);
				const position = liveStatements[0].getStart(live.source);
				const text = `${transplant(statement)}\n`;
				edits.push({ start: position, end: position, text });
				changes.push({
					label: `${key}:new-function`,
					start: position,
					end: position,
					oldSha256: sha256(""),
					newSha256: sha256(text),
				});
				continue;
			}
			if (old.normalized(previous) === next.normalized(statement)) continue;
			const oldMembers = members(old, previous);
			const newMembers = members(next, statement);
			const liveMembers = members(live, actual);
			if (oldMembers && newMembers && liveMembers) {
				for (const [memberKey, member] of newMembers) {
					const oldMember = oldMembers.get(memberKey);
					const actualMember = liveMembers.get(memberKey);
					if (!oldMember) {
						invariant(
							ts.isMethodDeclaration(member),
							`Only methods may be added to an existing class: ${key}`,
						);
						const position = actual.end - 1;
						const text = `\n  ${transplant(member)}\n`;
						edits.push({ start: position, end: position, text });
						changes.push({
							label: `${key}:${memberKey}:new`,
							start: position,
							end: position,
							oldSha256: sha256(""),
							newSha256: sha256(text),
						});
					} else if (old.normalized(oldMember) !== next.normalized(member))
						addEdit(actualMember, oldMember, member, `${key}:${memberKey}`);
				}
				invariant(
					[...oldMembers.keys()].every((memberKey) =>
						newMembers.has(memberKey),
					),
					`Removing class members is forbidden: ${key}`,
				);
			} else addEdit(actual, previous, statement, key);
		}
		// A renamed private helper may remain as unused original bytes. Runtime
		// declarations with observable initialization may never disappear.
		invariant(
			[...oldByKey].every(
				([key, statement]) =>
					ts.isFunctionDeclaration(statement) ||
					nextStatements.some(
						(nextStatement) => next.key(nextStatement) === key,
					),
			),
			`Removing initialized declarations is forbidden: ${owner}`,
		);
	}
	invariant(edits.length > 0, "No runtime changes found");
	edits.sort((a, b) => a.start - b.start || a.end - b.end);
	for (let index = 1; index < edits.length; index++)
		invariant(
			edits[index - 1].end <= edits[index].start,
			"Overlapping runtime edits",
		);
	let patched = "";
	let position = 0;
	const preserved = [];
	for (const edit of edits) {
		const unchanged = online.slice(position, edit.start);
		patched += unchanged + edit.text;
		preserved.push({
			start: position,
			end: edit.start,
			sha256: sha256(unchanged),
		});
		position = edit.end;
	}
	const tail = online.slice(position);
	patched += tail;
	preserved.push({ start: position, end: online.length, sha256: sha256(tail) });
	const resultModel = bundleModel(patched, ts);
	for (const owner of allowed) {
		const actual = new Map(
			(resultModel.modules.get(owner) ?? []).map((statement) => [
				resultModel.key(statement),
				statement,
			]),
		);
		for (const statement of next.modules.get(owner) ?? []) {
			const key = next.key(statement);
			const resultStatement = actual.get(key);
			invariant(
				resultStatement,
				`Transplanted runtime declaration missing: ${key}`,
			);
			const intendedMembers = members(next, statement);
			const resultMembers = members(resultModel, resultStatement);
			if (intendedMembers && resultMembers) {
				invariant(
					intendedMembers.size === resultMembers.size &&
						[...intendedMembers].every(
							([memberKey, member]) =>
								resultMembers.has(memberKey) &&
								next.normalized(member) ===
									resultModel.normalized(resultMembers.get(memberKey)),
						),
					`Transplanted class does not match intended source behavior: ${key}`,
				);
			} else
				invariant(
					resultModel.normalized(resultStatement) ===
						next.normalized(statement),
					`Transplanted runtime does not match intended source behavior: ${key}`,
				);
		}
	}
	return {
		patched,
		manifest: {
			schemaVersion: 1,
			strategy: "current-runtime-ast-transplant",
			onlineSha256: expectedOnlineSha256,
			sourceBaselineBuildSha256: sha256(baseline),
			candidateBuildSha256: sha256(candidate),
			patchedSha256: sha256(patched),
			edits: changes,
			preservedSegments: preserved,
			allowedModules: [...allowed],
		},
	};
}

/** Evaluate the real patched mapper/service and its declaration dependencies in
 * an isolated context. API bootstrap, database creation and listeners are never
 * included; networking globals deliberately throw. */
export function evaluateRuntimeExports(
	text,
	requests,
	typescript = loadTypeScript(),
	declarationStubs = {},
) {
	const model = bundleModel(text, typescript);
	const selected = new Set();
	const exports = [];
	const stubStatements = new Map();
	for (const [key, value] of Object.entries(declarationStubs)) {
		invariant(
			key === "packages/observability/src/index.ts:createNoopLogger" &&
				typeof value === "function",
			"Only the offline logger fixture may be substituted",
		);
		for (const declaration of model.declarations.values())
			if (`${declaration.owner}:${baseName(declaration.name)}` === key)
				stubStatements.set(declaration.statement, {
					name: declaration.name,
					key,
				});
	}
	function include(statement) {
		if (selected.has(statement)) return;
		selected.add(statement);
		if (stubStatements.has(statement)) return;
		function visit(node) {
			if (typescript.isIdentifier(node) && !model.property(node)) {
				const symbol = typescript.isShorthandPropertyAssignment(node.parent)
					? model.checker.getShorthandAssignmentValueSymbol(node.parent)
					: model.checker.getSymbolAtLocation(node);
				const key = model.symbols.get(symbol);
				if (key) include(model.declarations.get(key).statement);
			}
			typescript.forEachChild(node, visit);
		}
		visit(statement);
	}
	for (const [alias, owner, name] of requests) {
		const matches = [...model.declarations.values()].filter(
			(entry) => entry.owner === owner && baseName(entry.name) === name,
		);
		invariant(
			matches.length === 1,
			`Expected one runtime symbol ${owner}:${name}`,
		);
		include(matches[0].statement);
		exports.push(`${JSON.stringify(alias)}: ${matches[0].name}`);
	}
	const require = createRequire(import.meta.url);
	const builtins = new Set(
		builtinModules.map((name) => name.replace(/^node:/, "")),
	);
	const restrictedRequire = (name) => {
		invariant(
			builtins.has(name.replace(/^node:/, "")),
			`Offline runtime rejects external import ${name}`,
		);
		return require(name);
	};
	const statements = [...selected]
		.sort((left, right) => left.pos - right.pos)
		.map((statement) => {
			if (stubStatements.has(statement)) {
				const stub = stubStatements.get(statement);
				return `const ${stub.name} = __offlineStubs[${JSON.stringify(stub.key)}];`;
			}
			if (!typescript.isImportDeclaration(statement))
				return statement
					.getText(model.source)
					.replace(/\bimport\.meta\b/g, "__offlineImportMeta");
			const specifier = statement.moduleSpecifier.text;
			const parts = [];
			const clause = statement.importClause;
			if (clause?.name)
				parts.push(
					`const ${clause.name.text} = require(${JSON.stringify(specifier)});`,
				);
			const bindings = clause?.namedBindings;
			if (bindings && typescript.isNamedImports(bindings))
				parts.push(
					`const { ${bindings.elements.map((element) => `${element.propertyName?.text ?? element.name.text}: ${element.name.text}`).join(", ")} } = require(${JSON.stringify(specifier)});`,
				);
			else if (bindings)
				parts.push(
					`const ${bindings.name.text} = require(${JSON.stringify(specifier)});`,
				);
			invariant(
				parts.length > 0,
				"Offline runtime rejects side-effect imports",
			);
			return parts.join("\n");
		});
	const context = vm.createContext({
		require: restrictedRequire,
		__offlineStubs: declarationStubs,
		__offlineImportMeta: {
			url: "file:///offline-runtime.js",
			require: restrictedRequire,
		},
		URL,
		URLSearchParams,
		Buffer,
		TextEncoder,
		TextDecoder,
		AbortController,
		AbortSignal,
		setTimeout,
		clearTimeout,
		console: { log() {}, error() {}, warn() {} },
		fetch() {
			throw new Error("Offline runtime forbids network calls");
		},
		process: { env: {} },
	});
	vm.runInContext(
		`${statements.join("\n")}\nglobalThis.__paymentRuntimeExports = { ${exports.join(", ")} };`,
		context,
		{ timeout: 10000 },
	);
	return context.__paymentRuntimeExports;
}

if (
	process.argv[1] &&
	import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href
) {
	const [onlinePath, baselinePath, candidatePath, outputPath, manifestPath] =
		process.argv.slice(2);
	invariant(
		manifestPath,
		"Usage: bun tools/payment-parsing-discount-runtime.mjs ONLINE BASELINE_BUILD FINAL_BUILD OUTPUT MANIFEST",
	);
	const [online, baseline, candidate] = await Promise.all(
		[onlinePath, baselinePath, candidatePath].map((path) =>
			readFile(path, "utf8"),
		),
	);
	const result = createRuntimePatch({ online, baseline, candidate });
	await writeFile(outputPath, result.patched, { mode: 0o600 });
	await writeFile(
		manifestPath,
		`${JSON.stringify(result.manifest, null, 2)}\n`,
		{ mode: 0o600 },
	);
	console.log(
		JSON.stringify({
			patchedSha256: result.manifest.patchedSha256,
			changedDeclarations: result.manifest.edits.length,
			preservedSegments: result.manifest.preservedSegments.length,
		}),
	);
}
