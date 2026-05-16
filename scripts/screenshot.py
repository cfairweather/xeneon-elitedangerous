"""
Generate widget preview screenshots for the README.
Run from the repo root: python3 scripts/screenshot.py
Requires: pip3 install playwright && python3 -m playwright install chromium
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

PREVIEW_URL = "http://localhost:5500/index.html"
OUT_DIR = Path("docs/images")

# Shared base: docked, clean, with route + cargo + missions pre-populated
_BASE_STATE = """
  clearTimeout(state.reconnectTimer);
  if (state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }
  Object.assign(state, {
    wsStatus: 'connected', hadData: true,
    commander: 'FAIRWEATHER', credits: 924500000,
    gameMode: 'Open', legalState: 'Clean',
    starSystem: 'Shinrarta Dezhra', body: 'Shinrarta Dezhra A Belt',
    station: 'Jameson Memorial',
    shipName: 'DARK MATTER', shipType: 'Fer-de-Lance', shipIdent: 'ED-HZ',
    hullHealth: 0.87, shieldsUp: true,
    maxJumpRange: 28.34, fuelMain: 4.7, fuelCapacity: 8,
    fuelReservoir: 0.32, cargoUsed: 18, cargoCapacity: 64,
    pips: [2, 4, 2], flags: (1 << 0),
    route: [
      {StarSystem:'Shinrarta Dezhra',         StarClass:'F'},
      {StarSystem:'Arexe',                     StarClass:'K'},
      {StarSystem:'HIP 103138',                StarClass:'M'},
      {StarSystem:'LTT 9810',                  StarClass:'G'},
      {StarSystem:'Col 285 Sector YF-M c8-3', StarClass:'M'},
      {StarSystem:'Colonia',                   StarClass:'K'}
    ],
    manifest: [
      {key:'gold',      name:'Gold',      count:12, stolen:false, missionId:null},
      {key:'silver',    name:'Silver',    count: 4, stolen:false, missionId:98765},
      {key:'palladium', name:'Palladium', count: 2, stolen:true,  missionId:null}
    ],
    missions: [
      {id:1, name:'Deliver Goods to Colonia Hub',
       targetSystem:'Colonia', targetStation:'Colonia Hub',
       reward:2450000, expiry: new Date(Date.now()+7740000).toISOString()},
      {id:2, name:'Assassination: Wanted Pirate',
       targetSystem:'HIP 20277', targetStation:'',
       reward:8200000, expiry: new Date(Date.now()+2820000).toISOString()},
      {id:3, name:'Transport Passengers: Tourist Route',
       targetSystem:'Alioth', targetStation:'Irkutsk',
       reward:550000, expiry: null}
    ]
  });
  document.getElementById('overlay-connecting').style.display = 'none';
  document.getElementById('overlay-lost').style.display = 'none';
  document.getElementById('hud-root').style.display = '';
"""

HUD_JS = f"(function() {{{_BASE_STATE}  switchTab('hud'); renderHUD(); }})()"

COMBAT_JS = """
(function() {
  clearTimeout(state.reconnectTimer);
  if (state.ws) { state.ws.onclose = null; state.ws.close(); state.ws = null; }
  Object.assign(state, {
    wsStatus: 'connected', hadData: true,
    commander: 'FAIRWEATHER', credits: 924500000,
    gameMode: 'Open', legalState: 'Wanted',
    starSystem: 'HIP 20277', body: 'HIP 20277 1',
    station: null,
    shipName: 'DARK MATTER', shipType: 'Fer-de-Lance', shipIdent: 'ED-HZ',
    hullHealth: 0.19, shieldsUp: false,
    maxJumpRange: 28.34, fuelMain: 1.8, fuelCapacity: 8,
    fuelReservoir: 0.12, cargoUsed: 0, cargoCapacity: 64,
    pips: [4, 2, 2],
    flags: (1 << 6) | (1 << 19) | (1 << 22)
  });
  document.getElementById('overlay-connecting').style.display = 'none';
  document.getElementById('overlay-lost').style.display = 'none';
  document.getElementById('hud-root').style.display = '';
  switchTab('hud'); renderHUD();
})()
"""

NAV_JS = f"(function() {{{_BASE_STATE}  switchTab('nav'); renderNav(); }})()"

CARGO_JS = f"(function() {{{_BASE_STATE}  switchTab('cargo'); renderCargo(); }})()"

MISSIONS_JS = f"""(function() {{
{_BASE_STATE}
  switchTab('missions'); renderMissions();
  var b = document.getElementById('mission-badge');
  b.textContent = '3'; b.style.display = 'inline-flex';
}})()"""

CONNECTING_JS = """
(function() {
  document.getElementById('overlay-connecting').style.display = '';
  document.getElementById('overlay-lost').style.display = 'none';
  document.getElementById('hud-root').style.display = 'none';
  document.getElementById('connecting-msg').textContent = 'CONNECTING TO GALNET';
})()
"""

LOST_JS = f"(function() {{{_BASE_STATE}  renderHUD(); document.getElementById('overlay-lost').style.display = ''; }})()"

SHOTS = [
    # (filename,      width, height, js)
    ("xl-hud",       2536, 696, HUD_JS),
    ("xl-combat",    2536, 696, COMBAT_JS),
    ("xl-nav",       2536, 696, NAV_JS),
    ("xl-cargo",     2536, 696, CARGO_JS),
    ("xl-missions",  2536, 696, MISSIONS_JS),
    ("connecting",   2536, 696, CONNECTING_JS),
    ("signal-lost",  2536, 696, LOST_JS),
    ("medium",        840, 696, HUD_JS),
]

async def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for name, w, h, js in SHOTS:
            page = await browser.new_page(viewport={"width": w, "height": h})
            await page.goto(PREVIEW_URL, wait_until="networkidle")
            await page.wait_for_timeout(400)
            await page.evaluate(js)
            await page.wait_for_timeout(300)
            out = OUT_DIR / f"{name}.png"
            await page.screenshot(path=str(out), full_page=False)
            print(f"  saved {out}  ({w}x{h})")
            await page.close()
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
