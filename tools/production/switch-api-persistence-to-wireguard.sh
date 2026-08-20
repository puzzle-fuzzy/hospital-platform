#!/usr/bin/env bash

# 新 API 的 MySQL/Redis 私网切换脚本。
#
# 这个脚本必须在 192.168.112.172 上以 root 或具备等价 systemd 权限的账号执行。
# 它只修改新 Elysia API 的共享 env，并且只重启 hospital-platform-api-v2.service；
# 不读取、不改写旧 Python 的环境变量，不重启旧服务，也不修改阿里云防火墙。
#
# 设计为 fail-closed：
# 1. 只有当前两条连接仍指向已知公网地址时才允许 apply，防止误覆盖未知配置；
# 2. 修改前保留权限为 600 的回滚副本；
# 3. 新 API 重启失败、readiness 未恢复、WireGuard 连接未出现或旧 8001 端口消失时，
#    自动恢复 env 并只重启新 API；
# 4. `rollback` 只恢复本脚本生成的副本，拒绝使用任意路径，避免误操作其它密钥文件。

set -Eeuo pipefail
umask 077

readonly SERVICE_NAME="${API_V2_SERVICE_NAME:-hospital-platform-api-v2.service}"
readonly ENV_FILE="${API_V2_ENV_FILE:-/home/ps/code/hospital-platform/shared/api.env}"
readonly BACKUP_FILE="${ENV_FILE}.before-wireguard"
readonly PUBLIC_HOST="8.130.127.184"
readonly PRIVATE_HOST="10.0.0.1"
readonly READY_URL="http://10.0.0.3:18081/health/ready"
readonly OLD_PYTHON_PORT="8001"

mode="${1:-apply}"
changed=0

die() {
	printf '错误：%s\n' "$*" >&2
	exit 1
}

require_root() {
	if [[ "${EUID}" -ne 0 ]]; then
		die "必须以 root 或具备等价 systemd 权限的账号执行；不要强杀服务进程绕过权限边界。"
	fi
}

assert_fixed_paths() {
	[[ "$ENV_FILE" == "/home/ps/code/hospital-platform/shared/api.env" ]] || \
		die "拒绝使用非新 API 的 env 路径：$ENV_FILE"
	[[ "$SERVICE_NAME" == "hospital-platform-api-v2.service" ]] || \
		die "拒绝操作非新 API 的 systemd 单元：$SERVICE_NAME"
	[[ "$OLD_PYTHON_PORT" == "8001" ]] || \
		die "旧 Python 端口保护值被改变，拒绝继续：$OLD_PYTHON_PORT"
	[[ "$PRIVATE_HOST" == "10.0.0.1" ]] || \
		die "WireGuard 数据端点保护值被改变，拒绝继续：$PRIVATE_HOST"
}

assert_old_service_port() {
	# 这里只检查旧端口仍在监听，不向旧服务发送请求，不修改旧服务状态。
	ss -ltnH 2>/dev/null | awk -v wanted=":${OLD_PYTHON_PORT}" \
		'$4 ~ (wanted "$") { found = 1 } END { exit found ? 0 : 1 }' || \
		die "旧 Python 端口 ${OLD_PYTHON_PORT} 未监听，停止新 API 切换。"
}

assert_env_target_count() {
	local public_pattern private_pattern public_count private_count
	public_pattern="${PUBLIC_HOST//./\\.}"
	private_pattern="${PRIVATE_HOST//./\\.}"
	public_count="$(grep -Ec "^(DATABASE_URL|REDIS_URL)=.*${public_pattern}" "$ENV_FILE" || true)"
	private_count="$(grep -Ec "^(DATABASE_URL|REDIS_URL)=.*${private_pattern}" "$ENV_FILE" || true)"
	[[ "$public_count" == "2" ]] || \
		die "新 API env 中未找到恰好两条公网连接目标，拒绝修改。"
	[[ "$private_count" == "0" ]] || \
		die "新 API env 已包含私网目标或状态不明确，请人工核对后再执行。"
}

assert_private_target_count() {
	local private_pattern private_count public_pattern public_count
	private_pattern="${PRIVATE_HOST//./\\.}"
	public_pattern="${PUBLIC_HOST//./\\.}"
	private_count="$(grep -Ec "^(DATABASE_URL|REDIS_URL)=.*${private_pattern}" "$ENV_FILE" || true)"
	public_count="$(grep -Ec "^(DATABASE_URL|REDIS_URL)=.*${public_pattern}" "$ENV_FILE" || true)"
	[[ "$private_count" == "2" ]] || die "私网目标写入数量不是 2，停止。"
	[[ "$public_count" == "0" ]] || die "公网目标仍存在，停止。"
}

wait_for_ready() {
	local attempt=1 response=""
	while [[ "$attempt" -le 15 ]]; do
		if response="$(curl --fail --silent --show-error --max-time 5 "$READY_URL" 2>/dev/null)" && \
			grep -q '"status":"ready"' <<<"$response"; then
			return 0
		fi
		sleep 2
		attempt=$((attempt + 1))
	done
	return 1
}

assert_private_connections() {
	# readiness 已经探测 MySQL/Redis；这里再核对 TCP 连接目标确实落在 WireGuard，
	# 并且连接属于 Bun 新 API，而不是旧 Python 恰好连接到了同一私网端点。
	ss -tnpH 2>/dev/null | awk -v mysql="${PRIVATE_HOST}:3306" -v redis="${PRIVATE_HOST}:6379" \
		'$0 ~ mysql && $0 ~ /"bun"/ { mysql_ok = 1 } $0 ~ redis && $0 ~ /"bun"/ { redis_ok = 1 } END { exit (mysql_ok && redis_ok) ? 0 : 1 }' || \
		die "readiness 已恢复，但未观察到新 API 到 WireGuard MySQL/Redis 的连接。"
}

rollback_on_failure() {
	local exit_code="$?"
	trap - EXIT
	if [[ "$exit_code" -ne 0 && "$changed" -eq 1 ]]; then
		printf '检测失败，正在恢复新 API env 并仅重启新 API。\n' >&2
		if cp -p "$BACKUP_FILE" "$ENV_FILE" && systemctl restart "$SERVICE_NAME"; then
			printf '新 API 回滚完成；旧服务未被操作。\n' >&2
		else
			printf '严重：新 API 回滚重启未完成，请由维护人员检查 systemd。\n' >&2
		fi
	fi
	exit "$exit_code"
}

apply_private_target() {
	[[ ! -e "$BACKUP_FILE" ]] || \
		die "回滚副本已存在：$BACKUP_FILE；请人工核对，拒绝覆盖。"
	assert_old_service_port
	assert_env_target_count
	cp -p "$ENV_FILE" "$BACKUP_FILE"
	chmod 600 "$BACKUP_FILE"

	local public_pattern
	public_pattern="${PUBLIC_HOST//./\\.}"
	sed -i -E \
		"/^(DATABASE_URL|REDIS_URL)=/ s/${public_pattern}/${PRIVATE_HOST}/g" \
		"$ENV_FILE"
	changed=1
	assert_private_target_count

	systemctl restart "$SERVICE_NAME"
	sleep 2
	systemctl is-active --quiet "$SERVICE_NAME" || die "新 API 重启后未保持 active。"
	assert_old_service_port
	wait_for_ready || die "新 API readiness 在限定窗口内未恢复。"
	assert_private_connections

	# 副本故意保留，供当前维护窗口回滚；验收完成后由维护人员按保留策略删除。
	changed=0
	printf '新 API 已切换到 WireGuard 私网；旧 Python 端口仍在监听。\n'
	printf '回滚副本：%s\n' "$BACKUP_FILE"
}

rollback_private_target() {
	[[ -f "$BACKUP_FILE" ]] || die "找不到本脚本生成的回滚副本：$BACKUP_FILE"
	assert_old_service_port
	cp -p "$BACKUP_FILE" "$ENV_FILE"
	systemctl restart "$SERVICE_NAME"
	sleep 2
	systemctl is-active --quiet "$SERVICE_NAME" || die "新 API 回滚后未保持 active。"
	assert_old_service_port
	wait_for_ready || die "新 API 回滚后 readiness 未恢复。"
	printf '新 API 已回滚到切换前配置；旧 Python 服务未被操作。\n'
}

require_root
assert_fixed_paths
trap rollback_on_failure EXIT

case "$mode" in
	apply)
		apply_private_target
		;;
	rollback)
		rollback_private_target
		;;
	*)
		die "用法：$0 [apply|rollback]"
		;;
esac
