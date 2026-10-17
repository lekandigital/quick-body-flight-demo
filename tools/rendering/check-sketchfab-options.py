"""Inspect server-accepted embed options, without executing JS or telemetry.

This records what the server permits; it is not a rendered visual test.
"""
import concurrent.futures
import datetime
import html
import json
from pathlib import Path
import urllib.parse
import urllib.request

MODELS = {
    'galaxy': '96183eed1ae2425baddb75ca92103f87',
    'nebula': 'a1c688c6e8164fd4ad5a7e56047e8b50',
    'space': 'd6521362b37b48e3a82bce4911409303',
    'earth': '5ce4b1465c83432d9bb7e3c30232c02b',
    'orbit': '5f9c35be31a047928eace8b415a8ee3a',
    'hangar': '8f10be0e8b5644e1845a2a5f12af5d6c',
    'corridor': '1cdd1db557b8428892af4773bdada913',
    'gallery': 'ee6f3b0d9db14b62a1b3aeef04315313',
}
OPTIONS = dict(api_version='1.12.1', api_id=1, autostart=1, preload=1,
               camera=0, autospin=0, animation_autoplay=1, dnt=1,
               double_click=0, prevent_user_light_rotation=1)
for option in ('hint', 'controls', 'infos', 'stop', 'watermark', 'annotations',
               'animations', 'general_controls', 'help', 'settings', 'inspector',
               'vr', 'ar', 'fullscreen', 'loading', 'start'):
    OPTIONS['ui_' + option] = 0


def inspect(item):
    name, uid = item
    url = f'https://sketchfab.com/models/{uid}/embed?' + urllib.parse.urlencode(OPTIONS)
    with urllib.request.urlopen(url, timeout=60) as response:
        page = html.unescape(response.read().decode())
    marker = '"embedOptions":'
    start = page.index(marker) + len(marker)
    options = json.JSONDecoder().raw_decode(page[start:])[0]
    observed = {key: options.get(key) for key in (
        'uiWatermark', 'uiHint', 'uiControls', 'uiGeneralControls',
        'uiHelp', 'uiSettings', 'uiInspector', 'uiVr', 'uiFullscreen', 'dnt')}
    clean = all(not observed[key] for key in ('uiWatermark', 'uiHint', 'uiControls', 'uiGeneralControls'))
    return name, dict(uid=uid, url=url, accepted=observed, permitsCleanUI=clean)


if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        models = dict(pool.map(inspect, MODELS.items()))
    report = dict(checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  method='Server embedOptions HTML; no JavaScript executed',
                  requested=OPTIONS, models=models)
    output = Path('docs/rendering/sketchfab-embed-capabilities.json')
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value['accepted'] | {'permitsCleanUI': value['permitsCleanUI']}
                      for key, value in models.items()}, indent=2))
