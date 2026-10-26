import { afterEach, expect, test } from "bun:test";
import { Table } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { fetchWechatRefundPaymentHistory as fetchAdmin2History } from "../../admin2/apps/web-antd/src/hospital/api";
import { fetchWechatRefundPaymentHistory } from "./api";
import { paymentRecordColumns } from "./PaymentPanel";
import { SimplePaymentList } from "./SimplePaymentList";
import type { AdminWechatRefundPaymentRecord, Session } from "./types";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const session: Session = {
	accessToken: "synthetic-session",
	refreshToken: "",
	tokenType: "Bearer",
	expiresIn: 3600,
	username: "synthetic-operator",
};
const record: AdminWechatRefundPaymentRecord = {
	source: "payment_order",
	orderId: "synthetic-order",
	business: "registration",
	patientDisplayName: "合成就诊人",
	orderUserDisplayName: "合成下单用户",
	patientIdentityNumber: "11010519900101007X",
	totalFen: 1000,
	paymentState: "paid",
	cashPaymentConfirmed: true,
	cashFen: 1000,
	actualCashFen: 1000,
	hospitalDiscountFen: 0,
	actualPaidFen: 1000,
	amountBreakdownStatus: "confirmed",
	refundReservedFen: 0,
	refundableFen: 1000,
	refundCount: 0,
	refundRoute: "admin",
	createdAt: "2026-10-26T00:00:00Z",
	updatedAt: "2026-10-26T00:00:00Z",
};
const noop = () => {};

for (const [name, fetchHistory] of [
	["React", fetchWechatRefundPaymentHistory],
	["Admin2", fetchAdmin2History],
] as const) {
	test(`${name} 支付查询保留姓名、完整身份证及分页条件，空条件不发送`, async () => {
		const queries: URLSearchParams[] = [];
		globalThis.fetch = (async (path) => {
			queries.push(
				new URL(String(path), "https://synthetic.example").searchParams,
			);
			return Response.json({ code: 0, data: { items: [record] } });
		}) as typeof fetch;
		const result = await fetchHistory(
			{
				participantName: "  合成 & 用户%  ",
				identityNumber: " 11010519900101007x ",
				page: 3,
				pageSize: 8,
				source: "payment_order",
			},
			session,
		);
		expect(queries[0]?.get("participantName")).toBe("合成 & 用户%");
		expect(queries[0]?.get("identityNumber")).toBe("11010519900101007X");
		expect(queries[0]?.get("page")).toBe("3");
		expect(queries[0]?.get("source")).toBe("payment_order");
		expect(result.items[0]?.patientIdentityNumber).toBe(
			record.patientIdentityNumber,
		);
		await fetchHistory({ participantName: " ", identityNumber: " " }, session);
		expect([...(queries[1]?.keys() ?? [])]).toEqual([]);
	});
}

test("支付表及简洁展示明确身份证属于就诊人，缺失不猜测下单用户", () => {
	const columns = paymentRecordColumns(noop, noop, noop, noop);
	const table = (item: AdminWechatRefundPaymentRecord) =>
		renderToStaticMarkup(
			<Table
				columns={columns}
				dataSource={[item]}
				pagination={false}
				rowKey="orderId"
			/>,
		);
	const markup = table(record);
	expect(markup).toContain("就诊人身份证号");
	expect(markup).toContain("11010519900101007X");
	expect(markup).toContain("合成就诊人");
	expect(markup).toContain("合成下单用户");
	const missingIdentity = { ...record };
	delete missingIdentity.patientIdentityNumber;
	expect(table(missingIdentity)).toContain("未留存");
	const simple = renderToStaticMarkup(
		<SimplePaymentList
			items={[record]}
			loading={false}
			page={1}
			pageSize={20}
			total={1}
			readOnly
			onRefresh={noop}
			onPageChange={noop}
			onRefund={noop}
			onRefundQuery={noop}
			onSearch={noop}
			onReset={noop}
		/>,
	);
	expect(simple).toContain("姓名/用户名");
	expect(simple).toContain("就诊人身份证号");
	expect(simple).toContain("11010519900101007X");
	expect(simple).toContain("当前账号仅可查看");
});

test("共享管理端代理仅转发合法姓名和完整身份证，不扩展权限、不记录查询身份", () => {
	const script = `
import assert from "node:assert/strict";
let handler; const calls=[]; const logs=[];
console.info=(...value)=>logs.push(value);
Bun.serve=(options)=>{handler=options.fetch;return {hostname:"fixture",port:0}};
globalThis.fetch=async(url,init)=>{
 const parsed=new URL(url);calls.push({path:parsed.pathname,query:Object.fromEntries(parsed.searchParams)});
 if(parsed.pathname.endsWith('/system/auth/login'))return Response.json({code:0,data:{access_token:'synthetic-session',token_type:'Bearer',expires_in:1800}});
 return Response.json({success:true,data:{items:[{patientDisplayName:'合成就诊人',patientIdentityNumber:'11010519900101007X'}],total:1,page:1,pageSize:8}});
};
await import(SERVER_URL);
const request=(path,method='GET',token,body)=>handler(new Request('https://admin.example'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),{requestIP:()=>({address:crypto.randomUUID()})});
assert.equal((await request('/api/refunds/wechat/payments?participantName=synthetic')).status,401);
assert.equal(calls.length,0);
assert.equal((await request('/api/auth/login','POST',undefined,{username:'operator',password:'synthetic',loginMode:'operator'})).status,200);
const path='/api/refunds/wechat/payments';
const query=new URLSearchParams({participantName:' 合成用户名 ',identityNumber:' 11010519900101007x ',page:'2'});
const response=await request(path+'?'+query,'GET','synthetic-session');assert.equal(response.status,200);
assert.equal(calls.at(-1).query.participantName,'合成用户名');assert.equal(calls.at(-1).query.identityNumber,'11010519900101007X');assert.equal(calls.at(-1).query.page,'2');
const before=calls.length;
for(const query of [new URLSearchParams({identityNumber:'123'}),new URLSearchParams({identityNumber:'11010519900101007%'}),new URLSearchParams({participantName:'合\\n成'}),new URLSearchParams({participantName:'合'.repeat(65)}),'identityNumber=11010519900101007X&identityNumber=11010519900101007X','participantName=a&participantName=b'])assert.equal((await request(path+'?'+query,'GET','synthetic-session')).status,400);
assert.equal(calls.length,before);
assert.equal((await request(path+'?identityNumber=110105900101007','GET','synthetic-session')).status,200);
assert.equal(calls.at(-1).query.identityNumber,'110105900101007');
assert(!JSON.stringify(logs).includes('11010519900101007X'));assert(!JSON.stringify(logs).includes('合成用户名'));
process.stdout.write(JSON.stringify({passed:true,realIO:0}));`;
	const result = Bun.spawnSync({
		cmd: [process.execPath, "--no-env-file", "run", "-"],
		stdin: Buffer.from(
			script.replace(
				"SERVER_URL",
				JSON.stringify(new URL("./server.ts", import.meta.url).href),
			),
		),
		env: {
			LEGACY_HOSPITAL_API_BASE_URL: "https://legacy.example/api/v1",
			ADMIN_REFUNDS_API_BASE_URL: "https://internal.example/api/v1",
			ADMIN_REFUNDS_API_TOKEN: "synthetic-token",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout.toString())).toEqual({
		passed: true,
		realIO: 0,
	});
});
