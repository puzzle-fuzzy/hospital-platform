"""Operator-only API release, derived from the existing production release workflow.

Run on the production host with: python3 THIS_FILE OPS_DIRECTORY prepare|activate
The caller must separately authorize and execute each action. Importing is inert.
"""
import fcntl
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request

ROOT = pathlib.Path('/home/ps/code/hospital-platform')
API = 'hospital-platform-api-v2.service'
WORKER = 'hospital-platform-worker-v2.service'
EXPECTED_ONLINE_API_SHA = '90d096bf5bc6aedfa42b823be509511e1e465ba09ad2fb2b62241e6faf358377'
OLD_ORDER_IDS = [
    '637254d6-5772-4fd0-876f-f1baf8d7fc57',
    'fbd5a73c-5481-4a09-8e32-21ab367e1632',
    '4b34bdee-b4b7-4a41-a2b7-228004743a8c',
    'b7c24bde-66b2-41fa-ba27-1ae3d8edd517',
    '9c7b0f9f-770f-48a3-9295-186860b4d44d',
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('command_failed:' + args[0])
    return result.stdout.strip()


def service(unit):
    return dict(line.split('=', 1) for line in run([
        'systemctl', 'show', unit, '-p', 'MainPID', '-p', 'ActiveState',
    ]).splitlines())


def env_hashes():
    return {path.name: sha(path) for path in (ROOT / 'shared').glob('*.env')}


def api_env():
    pid = int(service(API)['MainPID'])
    assert pid > 1
    return {key.decode(): value.decode()
            for item in pathlib.Path('/proc/' + str(pid) + '/environ').read_bytes().split(b'\0')
            if b'=' in item for key, value in [item.split(b'=', 1)]}


def fetch(url, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, json.loads(response.read())


def ready(port):
    for _ in range(25):
        try:
            status, result = fetch('http://10.0.0.3:' + str(port) + '/health/ready')
            data = result['data']
            if status == 200 and data['status'] == 'ready' and data['dependencies'] == dict(database='ok', redis='ok', schema='ok'):
                return data
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError('api_readiness_failed')


def readonly_regressions(port):
    """Only authenticated GET queries; retain low-sensitivity financial fields."""
    token = api_env()['ADMIN_REFUND_TOKEN']
    rows = {}
    fields = ['medicalStatus', 'wechatPaymentState', 'cashPaymentConfirmed',
              'totalFen', 'personalAccountFen', 'insuranceFen', 'actualCashFen',
              'hospitalDiscountFen', 'updatedAt']
    for order_id in OLD_ORDER_IDS:
        status, response = fetch(
            'http://10.0.0.3:' + str(port) + '/api/v1/admin/wechat-refund-payments?source=medical_insurance&orderId='
            + order_id + '&page=1&pageSize=1', {'x-admin-refund-token': token})
        assert status == 200 and response['data']['total'] == 1
        item = response['data']['items'][0]
        rows[order_id] = {key: item.get(key) for key in fields}
        refund = item.get('latestMedicalRefund')
        rows[order_id]['refund'] = {key: refund.get(key) for key in ['status', 'totalFen']} if refund else None
    return rows


def tree_signature(root):
    """Hash every current release file except the three explicit release outputs."""
    excluded = {'apps/api/dist/index.js', 'artifact-manifest.json', 'payment-parsing-discount-manifest.json'}
    records = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            path = pathlib.Path(directory) / name
            relative = path.relative_to(root).as_posix()
            if relative in excluded:
                continue
            if path.is_symlink():
                records.append([relative, 'link', os.readlink(path)])
            elif path.is_file():
                records.append([relative, 'file', sha(path)])
    return hashlib.sha256(json.dumps(sorted(records), separators=(',', ':')).encode()).hexdigest()


def main():
    os.umask(0o077)
    assert len(sys.argv) == 3, 'expected_ops_directory_and_action'
    ops = pathlib.Path(sys.argv[1]).resolve()
    assert ops.parent == ROOT / 'ops', 'ops_directory_outside_expected_root'
    action = sys.argv[2]
    assert action in ['prepare', 'activate'], 'invalid_action'
    manifest = json.loads((ops / 'manifest.json').read_text())
    name = manifest['releaseName']
    assert re.fullmatch(r'payment-parsing-discount-20261017-[0-9a-f]{12}', name)
    assert manifest['oldApiSha256'] == EXPECTED_ONLINE_API_SHA
    assert manifest['scope'] == ['api']
    assert manifest['apiSha256'].startswith(name.rsplit('-', 1)[1])
    old = ROOT / 'releases' / manifest['oldRelease']
    new = ROOT / 'releases' / name
    backup = ROOT / 'backups' / name
    admin = ROOT / 'admin-query/releases' / manifest['oldAdminRelease']
    assert old.parent == ROOT / 'releases' and admin.parent == ROOT / 'admin-query/releases'

    def baseline():
        assert (ROOT / 'current').resolve() == old and (ROOT / 'admin-query/current').resolve() == admin, 'live_release_changed'
        assert sha(old / 'apps/api/dist/index.js') == manifest['oldApiSha256'], 'api_baseline_hash_changed'
        assert sha(old / 'apps/worker/dist/index.js') == manifest['workerSha256'], 'worker_baseline_hash_changed'

    def save(state):
        (backup / 'state.json').write_text(json.dumps(state, indent=2) + '\n')

    def restart_api():
        run(['sudo', '-n', '/bin/systemctl', 'restart', API])

    def switch(target):
        temporary = ROOT / ('current.next-' + name)
        assert not temporary.exists() and not temporary.is_symlink()
        temporary.symlink_to(target, target_is_directory=True)
        os.replace(temporary, ROOT / 'current')

    # The same lock is shared with existing operator releases. CAS checks remain
    # required because prepare and activate are intentionally separate actions.
    with open(ROOT / 'ops/.deployment.lock', 'a') as deployment_lock:
        fcntl.flock(deployment_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        baseline()
        if action == 'prepare':
            assert not new.exists() and not backup.exists()
            backup.mkdir(mode=0o700)
            for relative in ['apps/api/dist/index.js', 'artifact-manifest.json']:
                destination = backup / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(old / relative, destination)
                assert sha(destination) == sha(old / relative)
            worker = service(WORKER)
            assert worker['ActiveState'] == 'active' and int(worker['MainPID']) > 1
            state = dict(backupVerified=True, oldRelease=str(old), worker=worker,
                         workerCwd=str(pathlib.Path('/proc/' + worker['MainPID'] + '/cwd').resolve()),
                         environmentHashes=env_hashes(), untouchedTreeSha256=tree_signature(old),
                         baselineRegressions=readonly_regressions(18081))
            save(state)
            shutil.copytree(old, new, symlinks=True)
            assert sha(ops / 'artifacts.tar.gz') == manifest['archiveSha256']
            with tarfile.open(ops / 'artifacts.tar.gz') as archive:
                members = archive.getmembers()
                assert len(members) == 1 and members[0].name == 'apps/api/dist/index.js' and members[0].isfile()
                with archive.extractfile(members[0]) as incoming:
                    (new / members[0].name).write_bytes(incoming.read())
            assert sha(new / 'apps/api/dist/index.js') == manifest['apiSha256']
            assert tree_signature(new) == state['untouchedTreeSha256'], 'unrelated_runtime_files_changed'
            artifact = json.loads((new / 'artifact-manifest.json').read_text())
            artifact.update(revision=name, releaseName=name, parentRelease=manifest['oldRelease'],
                            scope=['api'], sourceRevision=manifest.get('sourceRevision'),
                            strategy='current-runtime-ast-transplant')
            artifact['files']['apps/api/dist/index.js'] = manifest['apiSha256']
            (new / 'artifact-manifest.json').write_text(json.dumps(artifact, indent=2) + '\n')
            (new / 'payment-parsing-discount-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            assert not run(['ss', '-ltn', 'sport = :18082']).splitlines()[1:]
            with open(backup / 'canary.log', 'wb') as log:
                process = subprocess.Popen(['/home/ps/.bun/bin/bun', str(new / 'apps/api/dist/index.js')],
                                           cwd=new, env=dict(api_env(), HOST='10.0.0.3', PORT='18082'), stdout=log, stderr=log)
                try:
                    state['candidateReady'] = ready(18082)
                    assert readonly_regressions(18082) == state['baselineRegressions'], 'candidate_readonly_regression_changed'
                    state['candidateRegressionsPassed'] = True
                    save(state)
                finally:
                    process.send_signal(signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
            print(json.dumps(dict(prepared=True, release=name, candidateReady=True,
                                  readonlyRegressionsPassed=True, untouchedTreeVerified=True, paymentWriteCalls=0)))
        else:
            state = json.loads((backup / 'state.json').read_text())
            assert state['backupVerified'] and state['candidateReady'] and state['candidateRegressionsPassed']
            assert env_hashes() == state['environmentHashes'] and service(WORKER) == state['worker']
            assert tree_signature(old) == tree_signature(new) == state['untouchedTreeSha256']
            assert sha(new / 'apps/api/dist/index.js') == manifest['apiSha256']
            try:
                baseline()
                switch(new)
                restart_api()
                state['dependencies'] = ready(18081)
                assert readonly_regressions(18081) == state['baselineRegressions'], 'live_readonly_regression_changed'
                api = service(API)
                assert api['ActiveState'] == 'active' and int(api['MainPID']) > 1
                assert pathlib.Path('/proc/' + api['MainPID'] + '/cwd').resolve() == new
                assert service(WORKER) == state['worker']
                assert str(pathlib.Path('/proc/' + state['worker']['MainPID'] + '/cwd').resolve()) == state['workerCwd']
                assert (ROOT / 'admin-query/current').resolve() == admin and env_hashes() == state['environmentHashes']
                assert sha(new / 'apps/api/dist/index.js') == manifest['apiSha256']
                assert sha(new / 'apps/worker/dist/index.js') == manifest['workerSha256']
                assert tree_signature(new) == state['untouchedTreeSha256']
                status, public = fetch('https://test-hp.meiyi.pro/api/v2/health/ready')
                assert status == 200 and public['data']['status'] == 'ready'
                state.update(deployed=True, release=name, apiPid=int(api['MainPID']),
                             workerUnchanged=True, adminUnchanged=True, environmentUnchanged=True,
                             untouchedTreeVerified=True, publicReady=True)
                save(state)
                print(json.dumps({key: state[key] for key in ['deployed', 'release', 'apiPid', 'workerUnchanged',
                                                              'adminUnchanged', 'environmentUnchanged', 'untouchedTreeVerified', 'publicReady']}))
            except Exception:
                state['rollbackAttempted'] = True
                if (ROOT / 'current').resolve() == new:
                    switch(old)
                    restart_api()
                    ready(18081)
                    state['rolledBack'] = True
                save(state)
                raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps(dict(failed=True, errorType=type(error).__name__,
                              reason=str(error)[:120] if isinstance(error, (AssertionError, RuntimeError)) else 'details_suppressed')))
        sys.exit(1)
