#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

die() {
	echo "publish-3090: $*" >&2
	exit 1
}

usage() {
	echo '用法：tools/publish-3090.sh <commit-or-sha> [--surface api|worker|both] [--build] [--dry-run]'
	echo '默认只上传已构建产物；--surface api/worker 可复用另一发布面的 current 产物。'
	echo '环境变量：RELEASE_HOST、RELEASE_ROOT、SSH_OPTIONS（需要跳板机/密钥时使用）。'
}

if [[ $# -eq 1 && ( "$1" == '-h' || "$1" == '--help' ) ]]; then
	usage
	exit 0
fi
[[ $# -ge 1 ]] || { usage; exit 2; }
requested_revision="$1"
shift
surface=both
do_build=0
dry_run=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--surface)
			[[ $# -ge 2 ]] || die '--surface 缺少值'
			surface="$2"
			shift 2
			;;
		--build)
			do_build=1
			shift
			;;
		--dry-run)
			dry_run=1
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*) die "未知参数：$1" ;;
	esac
done
case "$surface" in
	api|worker|both) ;;
	*) die '--surface 必须是 api、worker 或 both' ;;
esac

for command_name in git rsync ssh sha256sum pnpm; do
	command -v "$command_name" >/dev/null 2>&1 || die "缺少命令：$command_name"
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${RELEASE_HOST:-}" ]]; then
	remote_host="$RELEASE_HOST"
else
	remote_host=3090-local
fi
if [[ -n "${RELEASE_ROOT:-}" ]]; then
	remote_root="$RELEASE_ROOT"
else
	remote_root=/home/ps/code/hospital-platform
fi
[[ "$remote_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || die 'RELEASE_ROOT 含有不安全字符'
ssh_args=()
rsync_args=()
if [[ -n "${SSH_OPTIONS:-}" ]]; then
	read -r -a ssh_args <<< "$SSH_OPTIONS"
	rsync_args=(-e "ssh $SSH_OPTIONS")
fi
ssh_remote() { ssh "${ssh_args[@]}" "$remote_host" "$@"; }

new_sha="$(git -C "$repo_root" rev-parse --verify "$requested_revision^{commit}" 2>/dev/null)" ||
	die "无法解析候选提交：$requested_revision"
[[ "$new_sha" =~ ^[0-9a-f]{40}$ ]] || die '候选提交不是完整 SHA'
if [[ -n "$(git -C "$repo_root" status --porcelain)" ]]; then
	echo '警告：工作区有未提交改动；本脚本只上传 dist/Java 产物。' >&2
fi

if (( do_build )); then
	case "$surface" in
		api) ( cd "$repo_root" && pnpm --filter @hospital/api build ) ;;
		worker) ( cd "$repo_root" && pnpm --filter @hospital/worker build ) ;;
		both) ( cd "$repo_root" && pnpm --filter @hospital/api build && pnpm --filter @hospital/worker build ) ;;
	esac
fi

api_file=apps/api/dist/index.js
if [[ "$surface" == api || "$surface" == both ]]; then
	[[ -f "$repo_root/$api_file" ]] || die '缺少 API 构建产物，请先定向构建'
fi
if [[ "$surface" == worker || "$surface" == both ]]; then
	[[ -s "$repo_root/apps/worker/dist/index.js" ]] || die '缺少 Worker 主 bundle，请先定向构建'
fi
if [[ "$surface" == both ]]; then
	[[ -n "$(cd "$repo_root" && find packages/adapters/dist/java-sdk -type f -print -quit)" ]] ||
		die '缺少 Java SDK 产物，请复用或构建已验证产物'
fi

if (( dry_run )); then
	printf '{\n  "release": "%s",\n  "surface": "%s",\n  "status": "dry-run"\n}\n' "$new_sha" "$surface"
	exit 0
fi

old_target="$(ssh_remote "readlink -f '$remote_root/current'")" || die '无法读取远端 current'
old_sha="$(basename "$old_target")"
[[ "$old_sha" =~ ^[0-9a-f]{7,40}$ ]] || die "远端 current 不是可回滚的 release：$old_target"
[[ "$old_sha" != "$new_sha" ]] || die "候选 SHA 已经是当前 release：$new_sha"

release_dir="$remote_root/releases/$new_sha"

ssh_remote "mkdir -p '$release_dir/apps/api/dist' '$release_dir/apps/worker/dist' '$release_dir/packages/adapters/dist/java-sdk' && test -f '$remote_root/shared/api.env' && test \"\$(stat -c '%a' '$remote_root/shared/api.env')\" = 600 && grep -q '^PROVIDER_RAW_LOGGING=true$' '$remote_root/shared/api.env'" ||
	die '远端 shared/api.env 不存在、权限不是 600 或原始日志未开启'

if [[ "$surface" == api || "$surface" == both ]]; then
	rsync "${rsync_args[@]}" -a --checksum "$repo_root/apps/api/dist/" "$remote_host:$release_dir/apps/api/dist/"
else
	ssh_remote "test -s '$remote_root/releases/$old_sha/apps/api/dist/index.js' && cp -a '$remote_root/releases/$old_sha/apps/api/dist/.' '$release_dir/apps/api/dist/'" ||
		die '无法复用旧 API 产物'
fi

if [[ "$surface" == worker || "$surface" == both ]]; then
	rsync "${rsync_args[@]}" -a --checksum "$repo_root/apps/worker/dist/" "$remote_host:$release_dir/apps/worker/dist/"
else
	ssh_remote "test -s '$remote_root/releases/$old_sha/apps/worker/dist/index.js' && cp -a '$remote_root/releases/$old_sha/apps/worker/dist/.' '$release_dir/apps/worker/dist/'" ||
		die '无法复用旧 Worker 产物'
fi

if [[ "$surface" == both ]]; then
	rsync "${rsync_args[@]}" -a --checksum "$repo_root/packages/adapters/dist/java-sdk/" "$remote_host:$release_dir/packages/adapters/dist/java-sdk/"
else
	ssh_remote "test -d '$remote_root/releases/$old_sha/packages/adapters/dist/java-sdk' && cp -a '$remote_root/releases/$old_sha/packages/adapters/dist/java-sdk/.' '$release_dir/packages/adapters/dist/java-sdk/'" ||
		die '无法复用旧 Java SDK 产物'
fi

checksum_file="/tmp/publish-3090-checksum-$new_sha"
cleanup() {
	rm -f "$checksum_file"
}
trap cleanup EXIT
(
	cd "$repo_root"
	if [[ "$surface" == api || "$surface" == both ]]; then
		sha256sum "$api_file"
	fi
	if [[ "$surface" == worker || "$surface" == both ]]; then
		find apps/worker/dist -type f -name '*.js' -exec sha256sum {} +
	fi
	if [[ "$surface" == both ]]; then
		find packages/adapters/dist/java-sdk -type f -exec sha256sum {} +
	fi
) >"$checksum_file"
rsync "${rsync_args[@]}" -a "$checksum_file" "$remote_host:$release_dir/.release-checksums"
ssh_remote "cd '$release_dir' && sha256sum -c .release-checksums" || die '远端产物 checksum 校验失败'
ssh_remote "test -s '$release_dir/apps/api/dist/index.js' && test -s '$release_dir/apps/worker/dist/index.js'" ||
	die '远端 release 缺少 API 或 Worker 主 bundle'

ssh_remote "cd '$remote_root' && next='current.next-$new_sha-\$(date +%s)' && ln -s 'releases/$new_sha' \"\$next\" && mv -Tf \"\$next\" current" ||
	die '原子切换 current 失败，未执行重启'

rollback() {
	echo "正在回滚到 $old_sha ..." >&2
	if ! ssh_remote bash -s -- "$remote_root" "$old_sha" <<'REMOTE_ROLLBACK'
set -eu
root="$1"
old="$2"
cd "$root"
rollback_link="current.rollback-$old-$(date +%s)"
ln -s "releases/$old" "$rollback_link"
mv -Tf "$rollback_link" current
sudo -n systemctl restart hospital-platform-api-v2.service
REMOTE_ROLLBACK
	then
		echo "警告：自动回滚失败，请管理员检查 $remote_root/current" >&2
	fi
}

if ! ssh_remote "sudo -n systemctl restart hospital-platform-api-v2.service"; then
	rollback
	die 'API 重启失败'
fi

if ! ssh_remote bash -s -- "$remote_root" <<'REMOTE_READINESS'
set -eu
root="$1"
for attempt in $(seq 1 15); do
	if curl -fsS --max-time 2 http://10.0.0.3:18081/health/ready |
		jq -e '.success == true and .data.status == "ready" and .data.dependencies.database == "ok" and .data.dependencies.redis == "ok" and .data.dependencies.schema == "ok"' >/dev/null 2>&1 &&
		ss -ltn | grep -Eq ':18081' &&
		ss -ltn | grep -Eq ':8001'; then
		exit 0
	fi
	test "$attempt" -eq 15 || sleep 1
done
exit 1
REMOTE_READINESS
then
	rollback
	die 'readiness 或 8001 共存检查失败'
fi

ssh_remote "sudo -n systemctl is-active hospital-platform-api-v2.service && test \"\$(readlink -f '$remote_root/current')\" = '$release_dir' && grep -q '^PROVIDER_RAW_LOGGING=true$' '$remote_root/shared/api.env'" ||
	die '发布后版本、服务或原始日志复核失败'

printf '{\n  "release": "%s",\n  "previous": "%s",\n  "surface": "%s",\n  "status": "ready"\n}\n' "$new_sha" "$old_sha" "$surface"
