/**
 * sm-crypto（0.5.x）没有官方类型声明，且 api/worker 程序会经路径映射直接
 * 编译本包源码；这里用显式类型包装替代包级 ambient 声明，保证所有
 * TypeScript 程序看到同一形状。
 *
 * 语义以库 README 为准：SM2 签名默认做 SM3+ZA 杂凑（hash: true），
 * 输入/输出均为 hex 字符串；SM4 默认 ECB + PKCS#7，密钥为 32 位 hex。
 */
// @ts-expect-error sm-crypto 未提供类型声明，下方手写类型即本仓库唯一使用面。
import * as smCrypto from "sm-crypto";

type Sm2Api = {
	doSignature(
		msg: string | number[],
		privateKeyHex: string,
		options?: { hash?: boolean; userId?: string; der?: boolean },
	): string;
	doVerifySignature(
		msg: string | number[],
		signatureHex: string,
		publicKeyHex: string,
		options?: { hash?: boolean; userId?: string; der?: boolean },
	): boolean;
	generateKeyPairHex(): { publicKey: string; privateKey: string };
	doEncrypt(
		msg: string | number[],
		publicKeyHex: string,
		cipherMode?: number,
	): string;
	doDecrypt(
		cipherHex: string,
		privateKeyHex: string,
		cipherMode?: number,
	): string;
};

type Sm4Api = {
	encrypt(
		data: string | number[],
		key: string | number[],
		options?: {
			padding?: string;
			mode?: string;
			iv?: string;
			output?: string;
		},
	): string;
	decrypt(
		data: string | number[],
		key: string | number[],
		options?: {
			padding?: string;
			mode?: string;
			iv?: string;
			output?: string;
		},
	): string;
};

export const sm2 = smCrypto.sm2 as Sm2Api;
export const sm4 = smCrypto.sm4 as Sm4Api;
export const sm3 = smCrypto.sm3 as (msg: string | number[]) => string;
